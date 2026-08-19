import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { VideoOutbox } from '../entities/video-outbox.entity';

export const VIDEO_PROCESS_EVENT_TYPE = 'video.process';

@Injectable()
export class VideoOutboxRepository {
  constructor(
    @InjectRepository(VideoOutbox)
    private readonly outbox: Repository<VideoOutbox>,
  ) {}

  async findProcessRequestedByVideoId(
    videoId: string,
    manager?: EntityManager,
  ): Promise<VideoOutbox | null> {
    return (manager?.getRepository(VideoOutbox) ?? this.outbox).findOneBy({
      video_id: videoId,
      event_type: VIDEO_PROCESS_EVENT_TYPE,
    });
  }

  async createProcessRequested(
    manager: EntityManager,
    videoId: string,
  ): Promise<VideoOutbox> {
    const repository = manager.getRepository(VideoOutbox);

    return repository.save(
      repository.create({
        video_id: videoId,
        event_type: VIDEO_PROCESS_EVENT_TYPE,
        payload: { version: 1, videoId },
      }),
    );
  }

  async findUnpublished(limit: number): Promise<VideoOutbox[]> {
    return this.outbox.find({
      where: { published_at: IsNull() },
      order: { occurred_at: 'ASC' },
      take: limit,
    });
  }

  async markPublished(id: string, publishedAt: Date): Promise<boolean> {
    const result = await this.outbox.update(
      { id, published_at: IsNull() },
      { published_at: publishedAt },
    );

    return (result.affected ?? 0) === 1;
  }

  async recordPublishFailure(id: string, lastError: string): Promise<void> {
    await this.outbox.increment({ id }, 'publish_attempts', 1);
    await this.outbox.update({ id }, { last_error: lastError });
  }
}
