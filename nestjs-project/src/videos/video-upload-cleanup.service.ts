import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from './video-status.enum';
import { VideosRepository } from './repositories/videos.repository';

const CLEANUP_INTERVAL_MS = 60_000;

@Injectable()
export class VideoUploadCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(VideoUploadCleanupService.name);
  private cleanupInProgress: Promise<number> | undefined;
  private cleanupInterval: NodeJS.Timeout | undefined;

  constructor(
    private readonly dataSource: DataSource,
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.cleanupExpiredUploads();
    this.cleanupInterval = setInterval(() => {
      void this.runPeriodicCleanup();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    try {
      await this.cleanupInProgress;
    } catch {
      this.logger.warn('Video upload cleanup did not complete before shutdown');
    }
  }

  async cleanupExpiredUploads(): Promise<number> {
    if (this.cleanupInProgress) {
      return this.cleanupInProgress;
    }

    const cleanup = this.runCleanup();
    this.cleanupInProgress = cleanup;

    try {
      return await cleanup;
    } finally {
      this.cleanupInProgress = undefined;
    }
  }

  private async runPeriodicCleanup(): Promise<void> {
    try {
      await this.cleanupExpiredUploads();
    } catch {
      this.logger.warn('Video upload cleanup failed');
    }
  }

  private async runCleanup(): Promise<number> {
    const now = new Date();
    const expiredDrafts = await this.videosRepository.findExpiredDrafts(now);
    let cleanedCount = 0;

    for (const draft of expiredDrafts) {
      if (await this.cleanupExpiredDraft(draft.id, now)) {
        cleanedCount += 1;
      }
    }

    return cleanedCount;
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
        !video.multipart_expires_at ||
        video.multipart_expires_at.getTime() > now.getTime()
      ) {
        return false;
      }

      try {
        await this.storageService.abortMultipartUpload(
          video.storage_key,
          video.multipart_upload_id,
        );
      } catch (error) {
        if (!this.isMissingMultipartUpload(error)) {
          throw error;
        }
      }

      return this.videosRepository.deleteDraft(
        manager,
        video.id,
        video.multipart_upload_id,
      );
    });
  }

  private isMissingMultipartUpload(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    if ('name' in error && error.name === 'NoSuchUpload') {
      return true;
    }

    return (
      '$metadata' in error &&
      typeof error.$metadata === 'object' &&
      error.$metadata !== null &&
      'httpStatusCode' in error.$metadata &&
      error.$metadata.httpStatusCode === 404
    );
  }
}
