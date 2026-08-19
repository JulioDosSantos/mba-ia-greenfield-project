import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.module';
import {
  VIDEO_PROCESS_EVENT_TYPE,
  VideoOutboxRepository,
} from './repositories/video-outbox.repository';

const OUTBOX_PUBLISH_BATCH_SIZE = 100;
const VIDEO_PROCESS_ATTEMPTS = 3;
const VIDEO_PROCESS_BACKOFF_DELAY_MS = 1_000;
const QUEUE_PUBLISH_FAILED = 'QUEUE_PUBLISH_FAILED';

export type VideoProcessJob = {
  version: 1;
  videoId: string;
};

@Injectable()
export class VideoOutboxPublisher implements OnApplicationBootstrap {
  constructor(
    private readonly videoOutboxRepository: VideoOutboxRepository,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue<VideoProcessJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.publishPending();
  }

  async publishPending(): Promise<number> {
    const pendingEvents = await this.videoOutboxRepository.findUnpublished(
      OUTBOX_PUBLISH_BATCH_SIZE,
    );
    let publishedCount = 0;

    for (const event of pendingEvents) {
      try {
        await this.videoQueue.add(
          VIDEO_PROCESS_EVENT_TYPE,
          { version: 1, videoId: event.video_id },
          {
            jobId: event.video_id,
            attempts: VIDEO_PROCESS_ATTEMPTS,
            backoff: {
              type: 'exponential',
              delay: VIDEO_PROCESS_BACKOFF_DELAY_MS,
            },
          },
        );

        if (
          await this.videoOutboxRepository.markPublished(event.id, new Date())
        ) {
          publishedCount += 1;
        }
      } catch {
        await this.videoOutboxRepository.recordPublishFailure(
          event.id,
          QUEUE_PUBLISH_FAILED,
        );
      }
    }

    return publishedCount;
  }
}
