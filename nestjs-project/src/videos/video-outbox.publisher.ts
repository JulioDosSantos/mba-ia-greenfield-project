import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
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
const OUTBOX_RETRY_INTERVAL_MS = 10_000;

export type VideoProcessJob = {
  version: 1;
  videoId: string;
};

@Injectable()
export class VideoOutboxPublisher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(VideoOutboxPublisher.name);
  private publishInProgress: Promise<number> | undefined;
  private publishInterval: NodeJS.Timeout | undefined;

  constructor(
    private readonly videoOutboxRepository: VideoOutboxRepository,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue<VideoProcessJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.publishPending();
    this.publishInterval = setInterval(() => {
      void this.runPeriodicPublish();
    }, OUTBOX_RETRY_INTERVAL_MS);
    this.publishInterval.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
      this.publishInterval = undefined;
    }

    try {
      await this.publishInProgress;
    } catch {
      this.logger.warn(
        'Video outbox publication did not complete before shutdown',
      );
    }
  }

  async publishPending(): Promise<number> {
    if (this.publishInProgress) {
      return this.publishInProgress;
    }

    const publication = this.runPublication();
    this.publishInProgress = publication;

    try {
      return await publication;
    } finally {
      this.publishInProgress = undefined;
    }
  }

  private async runPeriodicPublish(): Promise<void> {
    try {
      await this.publishPending();
    } catch {
      this.logger.warn('Video outbox publication retry failed');
    }
  }

  private async runPublication(): Promise<number> {
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
