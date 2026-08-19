import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  StorageUnavailableException,
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import {
  StorageService,
  type StorageObjectStream,
} from '../storage/storage.service';
import { VideoStatus } from './video-status.enum';
import type { Video } from './entities/video.entity';
import { parseHttpByteRange } from './http-range.parser';
import { VideosRepository } from './repositories/videos.repository';

export type VideoDelivery = {
  statusCode: 200 | 206;
  headers: Record<string, string>;
  stream: Readable;
};

@Injectable()
export class VideoDeliveryService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
  ) {}

  async stream(
    userId: string,
    publicId: string,
    rangeHeader?: string,
  ): Promise<VideoDelivery> {
    const video = await this.resolveReadyVideo(userId, publicId);
    return this.openDelivery(video, rangeHeader);
  }

  async download(userId: string, publicId: string): Promise<VideoDelivery> {
    const video = await this.resolveReadyVideo(userId, publicId);
    const delivery = await this.openDelivery(video);

    return {
      ...delivery,
      headers: {
        ...delivery.headers,
        'content-disposition': this.createContentDisposition(
          video.original_filename,
        ),
      },
    };
  }

  private async openDelivery(
    video: Video,
    rangeHeader?: string,
  ): Promise<VideoDelivery> {
    const resourceSize = this.getStoredSize(video.size_bytes);
    const range = parseHttpByteRange(rangeHeader, resourceSize);
    const expectedLength = range?.length ?? resourceSize;

    let object: StorageObjectStream;
    try {
      object = await this.storageService.getObject(
        video.storage_key,
        range?.headerValue,
      );
    } catch {
      throw new StorageUnavailableException();
    }

    if (
      object.ContentLength !== expectedLength ||
      object.ContentType !== video.content_type
    ) {
      object.Body.destroy();
      throw new StorageUnavailableException();
    }

    return {
      statusCode: range ? 206 : 200,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(expectedLength),
        'content-type': video.content_type,
        ...(range && {
          'content-range': `bytes ${range.start}-${range.end}/${resourceSize}`,
        }),
      },
      stream: object.Body,
    };
  }

  private async resolveReadyVideo(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video =
      await this.videosRepository.findByPublicIdWithChannel(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.channel.user_id !== userId) {
      throw new VideoAccessDeniedException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    return video;
  }

  private getStoredSize(sizeBytes: string): number {
    const size = Number(sizeBytes);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new StorageUnavailableException();
    }

    return size;
  }

  private createContentDisposition(originalFilename: string): string {
    const filename =
      originalFilename
        .replaceAll('\u0000', '')
        .replaceAll('\r', '')
        .replaceAll('\n', '')
        .trim() || 'video';
    const asciiFilename = filename
      .replace(/[^\x20-\x7e]/g, '_')
      .replaceAll('"', '_')
      .replaceAll('\\', '_')
      .replaceAll('/', '_')
      .replaceAll(';', '_');
    const encodedFilename = encodeURIComponent(filename).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );

    return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
  }
}
