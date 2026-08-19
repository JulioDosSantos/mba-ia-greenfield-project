import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import type { Video } from './entities/video.entity';
import { VideosRepository } from './repositories/videos.repository';
import { VideoMediaProcessorService } from './video-media-processor.service';
import { VideoStatus } from './video-status.enum';
import { VideoWorkerProcessor } from './video-worker.processor';
import type { VideoProcessJob } from './video-outbox.publisher';

function createVideo(status: VideoStatus): Video {
  return {
    id: 'video-id',
    channel_id: 'channel-id',
    status,
  } as Video;
}

function createJob(attemptsMade = 0, attempts = 3): Job<VideoProcessJob> {
  return {
    data: { version: 1, videoId: 'video-id' },
    attemptsMade,
    opts: { attempts },
  } as Job<VideoProcessJob>;
}

describe('VideoWorkerProcessor', () => {
  let module: TestingModule;
  let processor: VideoWorkerProcessor;
  let videosRepository: jest.Mocked<VideosRepository>;
  let mediaProcessor: jest.Mocked<VideoMediaProcessorService>;

  beforeEach(async () => {
    videosRepository = {
      findById: jest.fn(),
      claimForProcessing: jest.fn(),
      incrementProcessingAttempts: jest.fn(),
      markReady: jest.fn(),
      markProcessingError: jest.fn(),
    } as unknown as jest.Mocked<VideosRepository>;
    mediaProcessor = {
      process: jest.fn(),
    } as unknown as jest.Mocked<VideoMediaProcessorService>;

    module = await Test.createTestingModule({
      providers: [
        VideoWorkerProcessor,
        { provide: VideosRepository, useValue: videosRepository },
        { provide: VideoMediaProcessorService, useValue: mediaProcessor },
      ],
    }).compile();

    processor = module.get(VideoWorkerProcessor);
  });

  afterEach(async () => {
    await module.close();
  });

  it('claims a draft, processes it, and writes the guarded ready state', async () => {
    const draft = createVideo(VideoStatus.DRAFT);
    const claimed = createVideo(VideoStatus.PROCESSING);
    videosRepository.findById
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(claimed);
    videosRepository.claimForProcessing.mockResolvedValue(true);
    mediaProcessor.process.mockResolvedValue({
      durationSeconds: 3,
      metadata: { video_codec: 'h264' },
      thumbnailKey: 'thumbnails/channel-id/video-id/thumbnail.jpg',
    });

    await processor.process(createJob());

    expect(videosRepository.claimForProcessing).toHaveBeenCalledWith(
      'video-id',
    );
    expect(videosRepository.incrementProcessingAttempts).toHaveBeenCalledWith(
      'video-id',
    );
    expect(mediaProcessor.process).toHaveBeenCalledWith(claimed);
    expect(videosRepository.markReady).toHaveBeenCalledWith('video-id', {
      duration_seconds: 3,
      metadata: { video_codec: 'h264' },
      thumbnail_key: 'thumbnails/channel-id/video-id/thumbnail.jpg',
    });
  });

  it('does not process a duplicate delivery for a ready video', async () => {
    videosRepository.findById.mockResolvedValue(createVideo(VideoStatus.READY));

    await processor.process(createJob());

    expect(videosRepository.claimForProcessing).not.toHaveBeenCalled();
    expect(mediaProcessor.process).not.toHaveBeenCalled();
    expect(videosRepository.markReady).not.toHaveBeenCalled();
  });

  it('does not process a concurrent first delivery already in processing', async () => {
    videosRepository.findById.mockResolvedValue(
      createVideo(VideoStatus.PROCESSING),
    );

    await processor.process(createJob());

    expect(videosRepository.incrementProcessingAttempts).not.toHaveBeenCalled();
    expect(mediaProcessor.process).not.toHaveBeenCalled();
  });

  it('rethrows retryable failures and marks only the final attempt as error', async () => {
    const processing = createVideo(VideoStatus.PROCESSING);
    videosRepository.findById.mockResolvedValue(processing);
    mediaProcessor.process.mockRejectedValue(new Error('ffmpeg failed'));

    await expect(processor.process(createJob(1, 3))).rejects.toThrow(
      'ffmpeg failed',
    );
    expect(videosRepository.markProcessingError).not.toHaveBeenCalled();

    await expect(processor.process(createJob(2, 3))).rejects.toThrow(
      'ffmpeg failed',
    );
    expect(videosRepository.markProcessingError).toHaveBeenCalledWith(
      'video-id',
      'VIDEO_PROCESSING_FAILED',
    );
  });
});
