import { Test, type TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';
import {
  RangeNotSatisfiableException,
  VideoAccessDeniedException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';
import { VideosRepository } from './repositories/videos.repository';
import { VideoDeliveryService } from './video-delivery.service';
import { VideoStatus } from './video-status.enum';

function createVideo(status = VideoStatus.READY, ownerId = 'owner-id'): Video {
  return {
    id: 'video-id',
    public_id: 'public-id',
    status,
    content_type: 'video/mp4',
    size_bytes: '100',
    storage_key: 'internal-source-key',
    original_filename: 'video "private".mp4',
    channel: { user_id: ownerId },
  } as Video;
}

describe('VideoDeliveryService', () => {
  let module: TestingModule;
  let deliveryService: VideoDeliveryService;
  let videosRepository: jest.Mocked<VideosRepository>;
  let storageService: jest.Mocked<StorageService>;

  beforeEach(async () => {
    videosRepository = {
      findByPublicIdWithChannel: jest.fn(),
    } as unknown as jest.Mocked<VideosRepository>;
    storageService = {
      getObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    module = await Test.createTestingModule({
      providers: [
        VideoDeliveryService,
        { provide: VideosRepository, useValue: videosRepository },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();
    deliveryService = module.get(VideoDeliveryService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('opens only an owner-ready video and returns opaque range delivery fields', async () => {
    const video = createVideo();
    videosRepository.findByPublicIdWithChannel.mockResolvedValue(video);
    storageService.getObject.mockResolvedValue({
      Body: Readable.from(Buffer.alloc(10)),
      ContentLength: 10,
      ContentRange: 'bytes 0-9/100',
      ContentType: 'video/mp4',
    });

    const delivery = await deliveryService.stream(
      'owner-id',
      video.public_id,
      'bytes=0-9',
    );

    expect(storageService.getObject).toHaveBeenCalledWith(
      'internal-source-key',
      'bytes=0-9',
    );
    expect(delivery).toMatchObject({
      statusCode: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': '10',
        'content-range': 'bytes 0-9/100',
        'content-type': 'video/mp4',
      },
    });
    expect(delivery).not.toHaveProperty('storage_key');
    expect(delivery).not.toHaveProperty('bucket');
    expect(delivery).not.toHaveProperty('url');
  });

  it('denies a non-owner before storage is opened', async () => {
    videosRepository.findByPublicIdWithChannel.mockResolvedValue(
      createVideo(VideoStatus.READY, 'another-user-id'),
    );

    await expect(
      deliveryService.stream('owner-id', 'public-id'),
    ).rejects.toBeInstanceOf(VideoAccessDeniedException);
    expect(storageService.getObject).not.toHaveBeenCalled();
  });

  it('rejects a non-ready video before storage is opened', async () => {
    videosRepository.findByPublicIdWithChannel.mockResolvedValue(
      createVideo(VideoStatus.PROCESSING),
    );

    await expect(
      deliveryService.stream('owner-id', 'public-id'),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    expect(storageService.getObject).not.toHaveBeenCalled();
  });

  it('rejects an unsatisfiable range before storage is opened', async () => {
    videosRepository.findByPublicIdWithChannel.mockResolvedValue(createVideo());

    await expect(
      deliveryService.stream('owner-id', 'public-id', 'bytes=100-100'),
    ).rejects.toBeInstanceOf(RangeNotSatisfiableException);
    expect(storageService.getObject).not.toHaveBeenCalled();
  });

  it('creates a safe UTF-8 download disposition without storage internals', async () => {
    const video = createVideo();
    videosRepository.findByPublicIdWithChannel.mockResolvedValue(video);
    storageService.getObject.mockResolvedValue({
      Body: Readable.from(Buffer.alloc(100)),
      ContentLength: 100,
      ContentRange: undefined,
      ContentType: 'video/mp4',
    });

    const delivery = await deliveryService.download('owner-id', 'public-id');

    expect(delivery.headers['content-disposition']).toBe(
      'attachment; filename="video _private_.mp4"; filename*=UTF-8\'\'video%20%22private%22.mp4',
    );
    expect(delivery).not.toHaveProperty('storage_key');
    expect(delivery).not.toHaveProperty('bucket');
  });
});
