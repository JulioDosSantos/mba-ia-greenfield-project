import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.module';
import { VideoOutbox } from './entities/video-outbox.entity';
import { VideoOutboxRepository } from './repositories/video-outbox.repository';
import { VideoOutboxPublisher } from './video-outbox.publisher';

const videoId = 'video-id';

function makeOutbox(): VideoOutbox {
  return Object.assign(new VideoOutbox(), {
    id: 'outbox-id',
    video_id: videoId,
    event_type: 'video.process',
    payload: { version: 1, videoId },
  });
}

describe('VideoOutboxPublisher', () => {
  let module: TestingModule;
  let publisher: VideoOutboxPublisher;
  let videoOutboxRepository: jest.Mocked<VideoOutboxRepository>;
  let videoQueue: { add: jest.Mock };

  beforeEach(async () => {
    videoOutboxRepository = {
      findUnpublished: jest.fn(),
      markPublished: jest.fn(),
      recordPublishFailure: jest.fn(),
    } as unknown as jest.Mocked<VideoOutboxRepository>;
    videoQueue = { add: jest.fn() };

    module = await Test.createTestingModule({
      providers: [
        VideoOutboxPublisher,
        { provide: VideoOutboxRepository, useValue: videoOutboxRepository },
        {
          provide: getQueueToken(VIDEO_PROCESSING_QUEUE),
          useValue: videoQueue,
        },
      ],
    }).compile();
    publisher = module.get(VideoOutboxPublisher);
  });

  afterEach(async () => {
    await module.close();
  });

  it('publishes the minimal job with deterministic retry options before marking the outbox row', async () => {
    const outbox = makeOutbox();
    videoOutboxRepository.findUnpublished.mockResolvedValue([outbox]);
    videoQueue.add.mockResolvedValue({ id: videoId });
    videoOutboxRepository.markPublished.mockResolvedValue(true);

    await expect(publisher.publishPending()).resolves.toBe(1);

    expect(videoQueue.add).toHaveBeenCalledWith(
      'video.process',
      { version: 1, videoId },
      {
        jobId: videoId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    );
    expect(videoOutboxRepository.markPublished).toHaveBeenCalledWith(
      outbox.id,
      expect.any(Date),
    );
    expect(videoOutboxRepository.recordPublishFailure).not.toHaveBeenCalled();
  });

  it('keeps the outbox unpublished when the queue is unavailable', async () => {
    const outbox = makeOutbox();
    videoOutboxRepository.findUnpublished.mockResolvedValue([outbox]);
    videoQueue.add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(publisher.publishPending()).resolves.toBe(0);

    expect(videoOutboxRepository.markPublished).not.toHaveBeenCalled();
    expect(videoOutboxRepository.recordPublishFailure).toHaveBeenCalledWith(
      outbox.id,
      'QUEUE_PUBLISH_FAILED',
    );
  });

  it('retries an unpublished event periodically after the queue recovers', async () => {
    jest.useFakeTimers();
    const outbox = makeOutbox();
    videoOutboxRepository.findUnpublished.mockResolvedValue([outbox]);
    videoQueue.add
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue({ id: videoId });
    videoOutboxRepository.markPublished.mockResolvedValue(true);

    try {
      await publisher.onApplicationBootstrap();
      expect(videoOutboxRepository.recordPublishFailure).toHaveBeenCalledWith(
        outbox.id,
        'QUEUE_PUBLISH_FAILED',
      );

      await jest.advanceTimersByTimeAsync(10_000);

      expect(videoQueue.add).toHaveBeenCalledTimes(2);
      expect(videoOutboxRepository.markPublished).toHaveBeenCalledWith(
        outbox.id,
        expect.any(Date),
      );
    } finally {
      await publisher.onApplicationShutdown();
      jest.useRealTimers();
    }
  });
});
