import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.module';
import { VideoStatus } from './video-status.enum';
import type { VideoProcessJob } from './video-outbox.publisher';
import { VideosRepository } from './repositories/videos.repository';
import { VideoMediaProcessorService } from './video-media-processor.service';

const VIDEO_PROCESSING_FAILED = 'VIDEO_PROCESSING_FAILED';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoWorkerProcessor extends WorkerHost {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly videoMediaProcessorService: VideoMediaProcessorService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessJob>): Promise<void> {
    const videoId = job.data.videoId;
    const video = await this.videosRepository.findById(videoId);

    if (
      !video ||
      video.status === VideoStatus.READY ||
      video.status === VideoStatus.ERROR
    ) {
      return;
    }

    if (video.status === VideoStatus.DRAFT) {
      if (!(await this.videosRepository.claimForProcessing(videoId))) {
        return;
      }
    } else if (
      video.status === VideoStatus.PROCESSING &&
      job.attemptsMade === 0
    ) {
      return;
    }

    const claimedVideo = await this.videosRepository.findById(videoId);
    if (!claimedVideo || claimedVideo.status !== VideoStatus.PROCESSING) {
      return;
    }

    await this.videosRepository.incrementProcessingAttempts(videoId);

    try {
      const processed =
        await this.videoMediaProcessorService.process(claimedVideo);
      await this.videosRepository.markReady(videoId, {
        duration_seconds: processed.durationSeconds,
        metadata: processed.metadata,
        thumbnail_key: processed.thumbnailKey,
      });
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.videosRepository.markProcessingError(
          videoId,
          VIDEO_PROCESSING_FAILED,
        );
      }

      throw error;
    }
  }

  private isFinalAttempt(job: Job<VideoProcessJob>): boolean {
    const attempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 >= attempts;
  }
}
