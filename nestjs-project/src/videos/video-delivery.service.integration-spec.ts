import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoOutbox } from './entities/video-outbox.entity';
import { Video } from './entities/video.entity';
import { VideosRepository } from './repositories/videos.repository';
import { VideoDeliveryService } from './video-delivery.service';
import { VideoStatus } from './video-status.enum';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  VideoOutbox,
];
const STORAGE_BUCKET = 'streamtube-media';

describe('VideoDeliveryService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let storageClient: S3Client;
  let deliveryService: VideoDeliveryService;
  const createdStorageKeys: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video, Channel]),
        StorageModule,
      ],
      providers: [VideosRepository, VideoDeliveryService],
    }).compile();
    await module.init();

    dataSource = module.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    storageService = module.get(StorageService);
    storageClient = module.get(S3Client);
    deliveryService = module.get(VideoDeliveryService);
  });

  afterAll(async () => {
    await removeCreatedObjects();
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  afterEach(async () => {
    await removeCreatedObjects();
  });

  async function removeCreatedObjects(): Promise<void> {
    await Promise.all(
      createdStorageKeys
        .splice(0)
        .map((Key) =>
          storageClient.send(
            new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key }),
          ),
        ),
    );
  }

  async function readStream(
    stream: AsyncIterable<Uint8Array>,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  it('streams an owner-ready private object range with exact headers and bytes', async () => {
    const payload = Buffer.from('private-stream-payload');
    const user = await userRepository.save(
      userRepository.create({
        email: `video_delivery_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Video delivery channel',
        nickname: `delivery_${randomUUID().replaceAll('-', '').slice(0, 32)}`,
        user_id: user.id,
      }),
    );
    const videoId = randomUUID();
    const storageKey = `videos/${channel.id}/${videoId}/source`;
    createdStorageKeys.push(storageKey);
    await storageService.putObject(storageKey, payload, 'video/mp4');
    const video = await videoRepository.save(
      videoRepository.create({
        id: videoId,
        channel_id: channel.id,
        public_id: randomUUID(),
        status: VideoStatus.READY,
        title: 'Private stream',
        original_filename: 'vídeo privado.mp4',
        content_type: 'video/mp4',
        size_bytes: String(payload.length),
        storage_key: storageKey,
      }),
    );

    const delivery = await deliveryService.stream(
      user.id,
      video.public_id,
      'bytes=3-9',
    );

    expect(delivery.statusCode).toBe(206);
    expect(delivery.headers).toEqual({
      'accept-ranges': 'bytes',
      'content-length': '7',
      'content-range': `bytes 3-9/${payload.length}`,
      'content-type': 'video/mp4',
    });
    await expect(readStream(delivery.stream)).resolves.toEqual(
      payload.subarray(3, 10),
    );
    expect(delivery).not.toHaveProperty('storage_key');
    expect(delivery).not.toHaveProperty('bucket');
    expect(delivery).not.toHaveProperty('url');
  }, 30_000);
});
