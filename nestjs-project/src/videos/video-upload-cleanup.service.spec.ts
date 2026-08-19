import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { VideosRepository } from './repositories/videos.repository';
import { VideoStatus } from './video-status.enum';
import { VideoUploadCleanupService } from './video-upload-cleanup.service';

function makeExpiredDraft(): Video {
  return Object.assign(new Video(), {
    id: 'video-id',
    status: VideoStatus.DRAFT,
    storage_key: 'videos/channel-id/video-id/source',
    multipart_upload_id: 'upload-id',
    multipart_expires_at: new Date(Date.now() - 1_000),
  });
}

describe('VideoUploadCleanupService', () => {
  let module: TestingModule;
  let service: VideoUploadCleanupService;
  let videosRepository: jest.Mocked<VideosRepository>;
  let storageService: jest.Mocked<StorageService>;

  beforeEach(async () => {
    videosRepository = {
      findExpiredDrafts: jest.fn(),
      findByIdForUpdate: jest.fn(),
      deleteDraft: jest.fn(),
    } as unknown as jest.Mocked<VideosRepository>;
    storageService = {
      abortMultipartUpload: jest.fn(),
      deleteObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    module = await Test.createTestingModule({
      providers: [
        VideoUploadCleanupService,
        {
          provide: DataSource,
          useValue: { transaction: jest.fn((callback) => callback({})) },
        },
        { provide: VideosRepository, useValue: videosRepository },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();
    service = module.get(VideoUploadCleanupService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('deletes a completed object before removing a stale draft with no multipart session', async () => {
    const draft = makeExpiredDraft();
    videosRepository.findExpiredDrafts.mockResolvedValue([draft]);
    videosRepository.findByIdForUpdate.mockResolvedValue(draft);
    videosRepository.deleteDraft.mockResolvedValue(true);
    storageService.abortMultipartUpload.mockRejectedValue({
      name: 'NoSuchUpload',
    });
    storageService.deleteObject.mockResolvedValue();

    await expect(service.cleanupExpiredUploads()).resolves.toBe(1);

    expect(storageService.deleteObject).toHaveBeenCalledWith(draft.storage_key);
    expect(videosRepository.deleteDraft).toHaveBeenCalledWith(
      expect.anything(),
      draft.id,
      draft.multipart_upload_id,
    );
  });
});
