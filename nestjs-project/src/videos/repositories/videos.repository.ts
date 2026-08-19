import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from '../video-status.enum';
import { Video } from '../entities/video.entity';

export type CreateVideoDraftValues = Pick<
  Video,
  | 'id'
  | 'channel_id'
  | 'public_id'
  | 'title'
  | 'original_filename'
  | 'content_type'
  | 'size_bytes'
  | 'storage_key'
  | 'multipart_upload_id'
  | 'multipart_expires_at'
>;

export type ReadyVideoValues = Pick<
  Video,
  'duration_seconds' | 'metadata' | 'thumbnail_key'
>;

@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
  ) {}

  async findChannelById(channelId: string): Promise<Channel | null> {
    return this.channels.findOneBy({ id: channelId });
  }

  async createDraft(
    manager: EntityManager,
    values: CreateVideoDraftValues,
  ): Promise<Video> {
    return manager.save(
      manager.create(Video, {
        ...values,
        status: VideoStatus.DRAFT,
      }),
    );
  }

  async findByIdInChannel(
    videoId: string,
    channelId: string,
  ): Promise<Video | null> {
    return this.videos.findOneBy({ id: videoId, channel_id: channelId });
  }

  async findById(videoId: string): Promise<Video | null> {
    return this.videos.findOneBy({ id: videoId });
  }

  async findByPublicIdWithChannel(publicId: string): Promise<Video | null> {
    return this.videos.findOne({
      where: { public_id: publicId },
      relations: { channel: true },
    });
  }

  async findByIdInChannelForUpdate(
    manager: EntityManager,
    videoId: string,
    channelId: string,
  ): Promise<Video | null> {
    return manager.getRepository(Video).findOne({
      where: { id: videoId, channel_id: channelId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findByIdForUpdate(
    manager: EntityManager,
    videoId: string,
  ): Promise<Video | null> {
    return manager.getRepository(Video).findOne({
      where: { id: videoId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async finalizeMultipartUpload(
    manager: EntityManager,
    videoId: string,
    uploadId: string,
    actualSizeBytes: string,
  ): Promise<boolean> {
    const result = await manager.getRepository(Video).update(
      {
        id: videoId,
        status: VideoStatus.DRAFT,
        multipart_upload_id: uploadId,
      },
      {
        multipart_upload_id: null,
        multipart_expires_at: null,
        size_bytes: actualSizeBytes,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  async deleteDraft(
    manager: EntityManager,
    videoId: string,
    uploadId: string,
  ): Promise<boolean> {
    const result = await manager.getRepository(Video).delete({
      id: videoId,
      status: VideoStatus.DRAFT,
      multipart_upload_id: uploadId,
    });

    return (result.affected ?? 0) === 1;
  }

  async findExpiredDrafts(now: Date): Promise<Video[]> {
    return this.videos.find({
      where: {
        status: VideoStatus.DRAFT,
        multipart_expires_at: LessThanOrEqual(now),
      },
      order: { multipart_expires_at: 'ASC' },
    });
  }

  async claimForProcessing(videoId: string): Promise<boolean> {
    const result = await this.videos.update(
      {
        id: videoId,
        status: VideoStatus.DRAFT,
        multipart_upload_id: IsNull(),
      },
      { status: VideoStatus.PROCESSING },
    );

    return (result.affected ?? 0) === 1;
  }

  async incrementProcessingAttempts(videoId: string): Promise<void> {
    await this.videos.increment(
      { id: videoId, status: VideoStatus.PROCESSING },
      'processing_attempts',
      1,
    );
  }

  async markReady(videoId: string, values: ReadyVideoValues): Promise<boolean> {
    const result = await this.videos.update(
      { id: videoId, status: VideoStatus.PROCESSING },
      {
        ...values,
        metadata: values.metadata as never,
        status: VideoStatus.READY,
        error_code: null,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  async markProcessingError(
    videoId: string,
    errorCode: string,
  ): Promise<boolean> {
    const result = await this.videos.update(
      { id: videoId, status: VideoStatus.PROCESSING },
      {
        status: VideoStatus.ERROR,
        error_code: errorCode,
      },
    );

    return (result.affected ?? 0) === 1;
  }
}
