import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageKeyFactory } from '../storage/storage-key.factory';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoOutbox } from './entities/video-outbox.entity';
import { Video } from './entities/video.entity';
import { VideoOutboxRepository } from './repositories/video-outbox.repository';
import { VideosRepository } from './repositories/videos.repository';
import { VideoOutboxPublisher } from './video-outbox.publisher';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  VideoOutbox,
];
const PART_SIZE_BYTES = 5 * 1024 * 1024;
const STORAGE_BUCKET = 'streamtube-media';

async function uploadPart(url: string, body: Buffer): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: Uint8Array.from(body),
  });
  const etag = response.headers.get('etag');

  expect(response.ok).toBe(true);
  expect(etag).not.toBeNull();
  return etag!;
}

describe('VideosService (integration)', () => {
  let storageModule: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let outboxRepository: Repository<VideoOutbox>;
  let videoOutboxPublisher: jest.Mocked<VideoOutboxPublisher>;
  let cleanupClient: S3Client;
  const createdKeys: string[] = [];
  let counter = 0;

  beforeAll(async () => {
    storageModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    await storageModule.init();

    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    outboxRepository = dataSource.getRepository(VideoOutbox);

    const storage = storageModule.get<ConfigType<typeof storageConfig>>(
      storageConfig.KEY,
    );
    const storageService = storageModule.get(StorageService);
    videoOutboxPublisher = {
      publishPending: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<VideoOutboxPublisher>;
    videosService = new VideosService(
      dataSource,
      new VideosRepository(videoRepository, channelRepository),
      new VideoOutboxRepository(outboxRepository),
      videoOutboxPublisher,
      storageService,
      new StorageKeyFactory(),
      storage,
    );
    cleanupClient = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT ?? 'http://minio:9000',
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
      },
      forcePathStyle: true,
    });
  });

  afterAll(async () => {
    await Promise.all(
      createdKeys.map((Key) =>
        cleanupClient.send(
          new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key }),
        ),
      ),
    );
    cleanupClient.destroy();
    await dataSource.destroy();
    await storageModule.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createOwnedChannel(): Promise<{
    channel: Channel;
    user: User;
  }> {
    counter += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_service_${counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Video service channel ${counter}`,
        nickname: `video_service_channel_${counter}`,
        user_id: user.id,
      }),
    );

    return { channel, user };
  }

  it('persists an owner-scoped draft, signs its multipart session, and cancels it', async () => {
    const { channel, user } = await createOwnedChannel();
    const draft = await videosService.startUpload(user.id, channel.id, {
      title: 'Draft upload',
      originalFilename: 'draft.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    });

    const signed = await videosService.signUploadParts(
      user.id,
      channel.id,
      draft.id,
      [1],
    );

    expect(draft.id).toEqual(expect.any(String));
    expect(draft.public_id).toEqual(expect.any(String));
    expect(draft.multipart_upload_id).toEqual(expect.any(String));
    expect(draft.storage_key).toBe(`videos/${channel.id}/${draft.id}/source`);
    expect(signed.parts).toHaveLength(1);
    expect(signed.parts[0].url).toContain('X-Amz-');

    await videosService.cancelUpload(user.id, channel.id, draft.id);

    expect(await videoRepository.findOneBy({ id: draft.id })).toBeNull();
  }, 30000);

  it('completes a real multipart upload, verifies its size, and creates one processing outbox record', async () => {
    const { channel, user } = await createOwnedChannel();
    const firstPart = Buffer.alloc(PART_SIZE_BYTES, 1);
    const secondPart = Buffer.from(`final-part-${randomUUID()}`);
    const draft = await videosService.startUpload(user.id, channel.id, {
      title: 'Completed upload',
      originalFilename: 'completed.mp4',
      contentType: 'video/mp4',
      sizeBytes: firstPart.length + secondPart.length,
    });
    createdKeys.push(draft.storage_key);
    const signed = await videosService.signUploadParts(
      user.id,
      channel.id,
      draft.id,
      [1, 2],
    );
    const firstEtag = await uploadPart(signed.parts[0].url, firstPart);
    const secondEtag = await uploadPart(signed.parts[1].url, secondPart);
    const parts = [
      { partNumber: 1, etag: firstEtag },
      { partNumber: 2, etag: secondEtag },
    ];

    const completed = await videosService.completeUpload(
      user.id,
      channel.id,
      draft.id,
      parts,
    );
    const duplicate = await videosService.completeUpload(
      user.id,
      channel.id,
      draft.id,
      parts,
    );

    expect(completed.multipart_upload_id).toBeNull();
    expect(completed.multipart_expires_at).toBeNull();
    expect(completed.size_bytes).toBe(
      (firstPart.length + secondPart.length).toString(),
    );
    expect(duplicate.id).toBe(draft.id);
    expect(videoOutboxPublisher.publishPending).toHaveBeenCalledTimes(2);
    expect(
      await outboxRepository.countBy({
        video_id: draft.id,
        event_type: 'video.process',
      }),
    ).toBe(1);
  }, 30000);

  it('aborts and removes a draft whose multipart session has expired', async () => {
    const { channel, user } = await createOwnedChannel();
    const draft = await videosService.startUpload(user.id, channel.id, {
      title: 'Expired draft',
      originalFilename: 'expired.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    });
    await videoRepository.update(draft.id, {
      multipart_expires_at: new Date(Date.now() - 1_000),
    });

    await expect(
      videosService.signUploadParts(user.id, channel.id, draft.id, [1]),
    ).rejects.toMatchObject({ errorCode: 'MULTIPART_UPLOAD_EXPIRED' });
    expect(await videoRepository.findOneBy({ id: draft.id })).toBeNull();
  }, 30000);
});
