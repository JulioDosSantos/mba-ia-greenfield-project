import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ChannelAccessDeniedException,
  ChannelNotFoundException,
  MultipartCompletionInvalidException,
  MultipartUploadExpiredException,
  StorageUnavailableException,
  VideoNotFoundException,
  VideoSizeLimitExceededException,
  VideoUploadNotDraftException,
  VideoUploadValidationException,
  UnsupportedVideoMediaTypeException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import {
  type MultipartUploadPart,
  type PresignedUploadPart,
  StorageService,
} from '../storage/storage.service';
import { StorageKeyFactory } from '../storage/storage-key.factory';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoOutboxRepository } from './repositories/video-outbox.repository';
import { VideosRepository } from './repositories/videos.repository';
import { VideoOutboxPublisher } from './video-outbox.publisher';

const MAX_VIDEO_SIZE_BYTES = 10_000_000_000;

export type CreateVideoUploadInput = {
  title: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
};

export type SignedVideoUploadParts = {
  expiresAt: Date;
  parts: PresignedUploadPart[];
};

type CompleteUploadResult =
  | { outcome: 'completed'; video: Video }
  | { outcome: 'expired' }
  | { outcome: 'oversized' };

@Injectable()
export class VideosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly videosRepository: VideosRepository,
    private readonly videoOutboxRepository: VideoOutboxRepository,
    private readonly videoOutboxPublisher: VideoOutboxPublisher,
    private readonly storageService: StorageService,
    private readonly storageKeyFactory: StorageKeyFactory,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  async startUpload(
    userId: string,
    channelId: string,
    input: CreateVideoUploadInput,
  ): Promise<Video> {
    this.assertValidDeclaredSize(input.sizeBytes);
    this.assertSupportedContentType(input.contentType);
    await this.assertChannelOwner(channelId, userId);

    const videoId = randomUUID();
    const storageKey = this.storageKeyFactory.createVideoSourceKey(
      channelId,
      videoId,
    );
    const uploadId = await this.createMultipartUpload(
      storageKey,
      input.contentType,
    );
    const multipartExpiresAt = new Date(
      Date.now() + this.storage.multipartUrlExpirationSeconds * 1000,
    );

    try {
      return await this.dataSource.transaction((manager) =>
        this.videosRepository.createDraft(manager, {
          id: videoId,
          channel_id: channelId,
          public_id: randomUUID(),
          title: input.title,
          original_filename: input.originalFilename,
          content_type: input.contentType,
          size_bytes: input.sizeBytes.toString(),
          storage_key: storageKey,
          multipart_upload_id: uploadId,
          multipart_expires_at: multipartExpiresAt,
        }),
      );
    } catch (error) {
      await this.abortUnpersistedMultipartUpload(storageKey, uploadId);
      throw error;
    }
  }

  async signUploadParts(
    userId: string,
    channelId: string,
    videoId: string,
    partNumbers: readonly number[],
  ): Promise<SignedVideoUploadParts> {
    this.assertValidPartNumbers(partNumbers);

    const video = await this.getActiveUpload(userId, channelId, videoId);

    try {
      return {
        expiresAt: video.multipart_expires_at!,
        parts: await this.storageService.signUploadParts(
          video.storage_key,
          video.multipart_upload_id!,
          partNumbers,
        ),
      };
    } catch {
      throw new StorageUnavailableException();
    }
  }

  getMultipartPartSizeBytes(): number {
    return this.storage.multipartPartSizeBytes;
  }

  async completeUpload(
    userId: string,
    channelId: string,
    videoId: string,
    parts: readonly MultipartUploadPart[],
  ): Promise<Video> {
    this.assertValidCompletedParts(parts);
    await this.assertChannelOwner(channelId, userId);

    const completion = await this.dataSource.transaction<CompleteUploadResult>(
      async (manager) => {
        const video = await this.videosRepository.findByIdInChannelForUpdate(
          manager,
          videoId,
          channelId,
        );
        if (!video) {
          throw new VideoNotFoundException();
        }
        if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
          const existingEvent =
            await this.videoOutboxRepository.findProcessRequestedByVideoId(
              video.id,
              manager,
            );
          if (existingEvent) {
            return { outcome: 'completed', video };
          }
          throw new VideoUploadNotDraftException();
        }

        if (this.isExpired(video.multipart_expires_at)) {
          const multipartWasMissing = await this.abortActiveMultipartUpload(
            video.storage_key,
            video.multipart_upload_id,
          );
          if (multipartWasMissing) {
            await this.deleteCompletedObject(video.storage_key);
          }
          const deleted = await this.videosRepository.deleteDraft(
            manager,
            video.id,
            video.multipart_upload_id,
          );
          if (!deleted) {
            throw new VideoUploadNotDraftException();
          }
          return { outcome: 'expired' };
        }

        const actualSizeBytes = await this.completeAndHeadMultipartUpload(
          video.storage_key,
          video.multipart_upload_id,
          parts,
        );
        if (actualSizeBytes > MAX_VIDEO_SIZE_BYTES) {
          await this.deleteCompletedObject(video.storage_key);
          const deleted = await this.videosRepository.deleteDraft(
            manager,
            video.id,
            video.multipart_upload_id,
          );
          if (!deleted) {
            throw new VideoUploadNotDraftException();
          }
          return { outcome: 'oversized' };
        }

        const finalized = await this.videosRepository.finalizeMultipartUpload(
          manager,
          video.id,
          video.multipart_upload_id,
          actualSizeBytes.toString(),
        );
        if (!finalized) {
          const existingEvent =
            await this.videoOutboxRepository.findProcessRequestedByVideoId(
              video.id,
              manager,
            );
          if (existingEvent) {
            return { outcome: 'completed', video };
          }
          throw new VideoUploadNotDraftException();
        }

        await this.videoOutboxRepository.createProcessRequested(
          manager,
          video.id,
        );

        video.multipart_upload_id = null;
        video.multipart_expires_at = null;
        video.size_bytes = actualSizeBytes.toString();
        return { outcome: 'completed', video };
      },
    );

    if (completion.outcome === 'expired') {
      throw new MultipartUploadExpiredException();
    }
    if (completion.outcome === 'oversized') {
      throw new VideoSizeLimitExceededException();
    }

    await this.videoOutboxPublisher.publishPending();
    return completion.video;
  }

  async cancelUpload(
    userId: string,
    channelId: string,
    videoId: string,
  ): Promise<void> {
    await this.assertChannelOwner(channelId, userId);

    await this.dataSource.transaction(async (manager) => {
      const video = await this.videosRepository.findByIdInChannelForUpdate(
        manager,
        videoId,
        channelId,
      );
      if (!video) {
        throw new VideoNotFoundException();
      }
      if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
        throw new VideoUploadNotDraftException();
      }

      const multipartWasMissing = await this.abortActiveMultipartUpload(
        video.storage_key,
        video.multipart_upload_id,
      );
      if (multipartWasMissing) {
        await this.deleteCompletedObject(video.storage_key);
      }
      await this.videosRepository.deleteDraft(
        manager,
        video.id,
        video.multipart_upload_id,
      );
    });
  }

  async cleanupExpiredDrafts(now = new Date()): Promise<number> {
    const expiredDrafts = await this.videosRepository.findExpiredDrafts(now);
    let deletedCount = 0;

    for (const expiredDraft of expiredDrafts) {
      if (await this.cleanupExpiredDraft(expiredDraft.id, now)) {
        deletedCount += 1;
      }
    }

    return deletedCount;
  }

  private async getActiveUpload(
    userId: string,
    channelId: string,
    videoId: string,
  ): Promise<Video> {
    await this.assertChannelOwner(channelId, userId);
    const video = await this.videosRepository.findByIdInChannel(
      videoId,
      channelId,
    );
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
      throw new VideoUploadNotDraftException();
    }
    if (this.isExpired(video.multipart_expires_at)) {
      await this.cleanupExpiredDraft(video.id, new Date());
      throw new MultipartUploadExpiredException();
    }

    return video;
  }

  private async assertChannelOwner(
    channelId: string,
    userId: string,
  ): Promise<void> {
    const channel = await this.videosRepository.findChannelById(channelId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }
    if (channel.user_id !== userId) {
      throw new ChannelAccessDeniedException();
    }
  }

  private async cleanupExpiredDraft(
    videoId: string,
    now: Date,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const video = await this.videosRepository.findByIdForUpdate(
        manager,
        videoId,
      );
      if (
        !video ||
        video.status !== VideoStatus.DRAFT ||
        !video.multipart_upload_id ||
        !this.isExpired(video.multipart_expires_at, now)
      ) {
        return false;
      }

      const multipartWasMissing = await this.abortActiveMultipartUpload(
        video.storage_key,
        video.multipart_upload_id,
      );
      if (multipartWasMissing) {
        await this.deleteCompletedObject(video.storage_key);
      }
      return this.videosRepository.deleteDraft(
        manager,
        video.id,
        video.multipart_upload_id,
      );
    });
  }

  private assertValidDeclaredSize(sizeBytes: number): void {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new VideoUploadValidationException();
    }
    if (sizeBytes > MAX_VIDEO_SIZE_BYTES) {
      throw new VideoSizeLimitExceededException();
    }
  }

  private assertSupportedContentType(contentType: string): void {
    if (!this.storage.allowedVideoMimeTypes.includes(contentType)) {
      throw new UnsupportedVideoMediaTypeException();
    }
  }

  private assertValidPartNumbers(partNumbers: readonly number[]): void {
    if (
      partNumbers.length === 0 ||
      partNumbers.some(
        (partNumber) => !Number.isSafeInteger(partNumber) || partNumber <= 0,
      ) ||
      new Set(partNumbers).size !== partNumbers.length
    ) {
      throw new VideoUploadValidationException();
    }
  }

  private assertValidCompletedParts(
    parts: readonly MultipartUploadPart[],
  ): void {
    if (
      parts.length === 0 ||
      parts.some(
        (part, index) =>
          !Number.isSafeInteger(part.partNumber) ||
          part.partNumber <= 0 ||
          part.etag.trim().length === 0 ||
          (index > 0 && part.partNumber <= parts[index - 1].partNumber),
      )
    ) {
      throw new MultipartCompletionInvalidException();
    }
  }

  private isExpired(expiresAt: Date | null, now = new Date()): boolean {
    return !expiresAt || expiresAt.getTime() <= now.getTime();
  }

  private async createMultipartUpload(
    storageKey: string,
    contentType: string,
  ): Promise<string> {
    try {
      const { uploadId } = await this.storageService.createMultipartUpload(
        storageKey,
        contentType,
      );
      return uploadId;
    } catch {
      throw new StorageUnavailableException();
    }
  }

  private async completeAndHeadMultipartUpload(
    storageKey: string,
    uploadId: string,
    parts: readonly MultipartUploadPart[],
  ): Promise<number> {
    try {
      await this.storageService.completeMultipartUpload(
        storageKey,
        uploadId,
        parts,
      );
      const object = await this.storageService.headObject(storageKey);
      const contentLength = object.ContentLength;
      if (
        typeof contentLength !== 'number' ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0
      ) {
        throw new StorageUnavailableException();
      }
      return contentLength;
    } catch (error) {
      if (error instanceof StorageUnavailableException) {
        throw error;
      }
      if (this.isInvalidMultipartCompletion(error)) {
        throw new MultipartCompletionInvalidException();
      }
      throw new StorageUnavailableException();
    }
  }

  private async abortActiveMultipartUpload(
    storageKey: string,
    uploadId: string,
  ): Promise<boolean> {
    try {
      await this.storageService.abortMultipartUpload(storageKey, uploadId);
      return false;
    } catch (error) {
      if (this.isMissingMultipartUpload(error)) {
        return true;
      }
      throw new StorageUnavailableException();
    }
  }

  private async deleteCompletedObject(storageKey: string): Promise<void> {
    try {
      await this.storageService.deleteObject(storageKey);
    } catch {
      throw new StorageUnavailableException();
    }
  }

  private async abortUnpersistedMultipartUpload(
    storageKey: string,
    uploadId: string,
  ): Promise<void> {
    try {
      await this.abortActiveMultipartUpload(storageKey, uploadId);
    } catch {
      // The database failure remains the primary error. A later lifecycle rule
      // cannot discover a multipart upload that was never persisted.
    }
  }

  private isInvalidMultipartCompletion(error: unknown): boolean {
    const errorName = this.getStorageErrorName(error);
    return errorName === 'InvalidPart' || errorName === 'InvalidPartOrder';
  }

  private isMissingMultipartUpload(error: unknown): boolean {
    return (
      this.getStorageErrorName(error) === 'NoSuchUpload' ||
      this.getStorageHttpStatus(error) === 404
    );
  }

  private getStorageErrorName(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'name' in error
      ? String(error.name)
      : undefined;
  }

  private getStorageHttpStatus(error: unknown): number | undefined {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('$metadata' in error) ||
      typeof error.$metadata !== 'object' ||
      error.$metadata === null ||
      !('httpStatusCode' in error.$metadata) ||
      typeof error.$metadata.httpStatusCode !== 'number'
    ) {
      return undefined;
    }

    return error.$metadata.httpStatusCode;
  }
}
