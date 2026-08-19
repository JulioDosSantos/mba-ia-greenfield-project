import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  ChannelAccessDeniedException,
  MultipartUploadExpiredException,
  VideoSizeLimitExceededException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { StorageKeyFactory } from '../storage/storage-key.factory';
import { Video } from './entities/video.entity';
import { VideoOutboxRepository } from './repositories/video-outbox.repository';
import { VideosRepository } from './repositories/videos.repository';
import { VideoOutboxPublisher } from './video-outbox.publisher';
import { VideosService } from './videos.service';

const ownerId = 'user-id';
const channelId = 'channel-id';
const videoId = 'video-id';

function makeVideo(overrides: Partial<Video> = {}): Video {
  return Object.assign(new Video(), {
    id: videoId,
    channel_id: channelId,
    public_id: 'public-id',
    status: 'DRAFT',
    title: 'Video title',
    original_filename: 'video.mp4',
    content_type: 'video/mp4',
    size_bytes: '1024',
    storage_key: 'videos/channel-id/video-id/source',
    thumbnail_key: null,
    multipart_upload_id: 'upload-id',
    multipart_expires_at: new Date(Date.now() + 60_000),
    duration_seconds: null,
    metadata: null,
    processing_attempts: 0,
    error_code: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });
}

describe('VideosService', () => {
  let module: TestingModule;
  let service: VideosService;
  let dataSource: { transaction: jest.Mock };
  let videosRepository: jest.Mocked<VideosRepository>;
  let videoOutboxRepository: jest.Mocked<VideoOutboxRepository>;
  let videoOutboxPublisher: jest.Mocked<VideoOutboxPublisher>;
  let storageService: jest.Mocked<StorageService>;
  let storageKeyFactory: jest.Mocked<StorageKeyFactory>;

  beforeEach(async () => {
    dataSource = {
      transaction: jest.fn((callback) => callback({})),
    };
    videosRepository = {
      findChannelById: jest.fn(),
      createDraft: jest.fn(),
      findByIdInChannel: jest.fn(),
      findByIdInChannelForUpdate: jest.fn(),
      findByIdForUpdate: jest.fn(),
      finalizeMultipartUpload: jest.fn(),
      deleteDraft: jest.fn(),
      findExpiredDrafts: jest.fn(),
      claimForProcessing: jest.fn(),
    } as unknown as jest.Mocked<VideosRepository>;
    videoOutboxRepository = {
      findProcessRequestedByVideoId: jest.fn(),
      createProcessRequested: jest.fn(),
      findUnpublished: jest.fn(),
      markPublished: jest.fn(),
      recordPublishFailure: jest.fn(),
    } as unknown as jest.Mocked<VideoOutboxRepository>;
    videoOutboxPublisher = {
      publishPending: jest.fn(),
    } as unknown as jest.Mocked<VideoOutboxPublisher>;
    videoOutboxPublisher.publishPending.mockResolvedValue(0);
    storageService = {
      createMultipartUpload: jest.fn(),
      signUploadParts: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      headObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;
    storageKeyFactory = {
      createVideoSourceKey: jest.fn(),
    } as unknown as jest.Mocked<StorageKeyFactory>;

    module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: DataSource, useValue: dataSource },
        { provide: VideosRepository, useValue: videosRepository },
        { provide: VideoOutboxRepository, useValue: videoOutboxRepository },
        { provide: VideoOutboxPublisher, useValue: videoOutboxPublisher },
        { provide: StorageService, useValue: storageService },
        { provide: StorageKeyFactory, useValue: storageKeyFactory },
        {
          provide: storageConfig.KEY,
          useValue: { multipartUrlExpirationSeconds: 900 },
        },
      ],
    }).compile();
    service = module.get(VideosService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('rejects a declared video size above 10 GB before contacting storage', async () => {
    await expect(
      service.startUpload(ownerId, channelId, {
        title: 'Too large',
        originalFilename: 'large.mp4',
        contentType: 'video/mp4',
        sizeBytes: 10_000_000_001,
      }),
    ).rejects.toBeInstanceOf(VideoSizeLimitExceededException);

    expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('does not sign parts for a caller who does not own the channel', async () => {
    videosRepository.findChannelById.mockResolvedValue({
      id: channelId,
      user_id: 'another-user',
    } as never);

    await expect(
      service.signUploadParts(ownerId, channelId, videoId, [1]),
    ).rejects.toBeInstanceOf(ChannelAccessDeniedException);

    expect(videosRepository.findByIdInChannel).not.toHaveBeenCalled();
    expect(storageService.signUploadParts).not.toHaveBeenCalled();
  });

  it('aborts and removes an expired draft before refusing more part URLs', async () => {
    const expiredVideo = makeVideo({
      multipart_expires_at: new Date(Date.now() - 1_000),
    });
    videosRepository.findChannelById.mockResolvedValue({
      id: channelId,
      user_id: ownerId,
    } as never);
    videosRepository.findByIdInChannel.mockResolvedValue(expiredVideo);
    videosRepository.findByIdForUpdate.mockResolvedValue(expiredVideo);
    videosRepository.deleteDraft.mockResolvedValue(true);
    storageService.abortMultipartUpload.mockResolvedValue();

    await expect(
      service.signUploadParts(ownerId, channelId, videoId, [1]),
    ).rejects.toBeInstanceOf(MultipartUploadExpiredException);

    expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
      expiredVideo.storage_key,
      expiredVideo.multipart_upload_id,
    );
    expect(videosRepository.deleteDraft).toHaveBeenCalled();
  });

  it('signs only valid requested part numbers for an active owner-scoped draft', async () => {
    const video = makeVideo();
    videosRepository.findChannelById.mockResolvedValue({
      id: channelId,
      user_id: ownerId,
    } as never);
    videosRepository.findByIdInChannel.mockResolvedValue(video);
    storageService.signUploadParts.mockResolvedValue([
      { partNumber: 1, url: 'https://storage.example/part-1' },
      { partNumber: 2, url: 'https://storage.example/part-2' },
    ]);

    const result = await service.signUploadParts(
      ownerId,
      channelId,
      videoId,
      [1, 2],
    );

    expect(result.parts).toHaveLength(2);
    expect(result.expiresAt).toBe(video.multipart_expires_at);
    expect(storageService.signUploadParts).toHaveBeenCalledWith(
      video.storage_key,
      video.multipart_upload_id,
      [1, 2],
    );
  });

  it('writes one outbox event after completion and returns the saved result on a duplicate request', async () => {
    const activeVideo = makeVideo();
    const completedVideo = makeVideo({
      multipart_upload_id: null,
      multipart_expires_at: null,
    });
    videosRepository.findChannelById.mockResolvedValue({
      id: channelId,
      user_id: ownerId,
    } as never);
    videosRepository.findByIdInChannelForUpdate
      .mockResolvedValueOnce(activeVideo)
      .mockResolvedValueOnce(completedVideo);
    videosRepository.finalizeMultipartUpload.mockResolvedValue(true);
    videoOutboxRepository.findProcessRequestedByVideoId.mockResolvedValue(
      {} as never,
    );
    storageService.completeMultipartUpload.mockResolvedValue();
    storageService.headObject.mockResolvedValue({
      ContentLength: 1024,
      ContentType: 'video/mp4',
    });
    videoOutboxRepository.createProcessRequested.mockResolvedValue({} as never);

    const parts = [{ partNumber: 1, etag: 'etag-1' }];
    const firstResult = await service.completeUpload(
      ownerId,
      channelId,
      videoId,
      parts,
    );
    const duplicateResult = await service.completeUpload(
      ownerId,
      channelId,
      videoId,
      parts,
    );

    expect(firstResult.multipart_upload_id).toBeNull();
    expect(firstResult.size_bytes).toBe('1024');
    expect(videoOutboxPublisher.publishPending).toHaveBeenCalledTimes(2);
    expect(duplicateResult).toBe(completedVideo);
    expect(videoOutboxRepository.createProcessRequested).toHaveBeenCalledTimes(
      1,
    );
    expect(storageService.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('aborts the active multipart session before deleting a draft on cancellation', async () => {
    const video = makeVideo();
    videosRepository.findChannelById.mockResolvedValue({
      id: channelId,
      user_id: ownerId,
    } as never);
    videosRepository.findByIdInChannelForUpdate.mockResolvedValue(video);
    videosRepository.deleteDraft.mockResolvedValue(true);
    storageService.abortMultipartUpload.mockResolvedValue();

    await expect(
      service.cancelUpload(ownerId, channelId, videoId),
    ).resolves.toBeUndefined();

    expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
      video.storage_key,
      video.multipart_upload_id,
    );
    expect(videosRepository.deleteDraft).toHaveBeenCalled();
  });
});
