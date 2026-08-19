import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Response as SuperAgentResponse } from 'superagent';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import storageConfig from '../src/config/storage.config';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';

type ChannelOwner = {
  accessToken: string;
  channel: Channel;
  user: User;
};

type ReadyVideoFixture = {
  payload: Buffer;
  video: Video;
};

function binaryParser(
  response: SuperAgentResponse,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
  response.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Video delivery (e2e)', () => {
  let app: INestApplication<App>;
  let channelRepository: Repository<Channel>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let s3Client: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  let storageService: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let userRepository: Repository<User>;
  let videoRepository: Repository<Video>;
  let sequence = 0;
  const createdStorageKeys = new Set<string>();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<INestApplication<App>>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    channelRepository = dataSource.getRepository(Channel);
    jwtService = moduleFixture.get(JwtService);
    s3Client = moduleFixture.get(S3Client);
    storage = moduleFixture.get<ConfigType<typeof storageConfig>>(
      storageConfig.KEY,
    );
    storageService = moduleFixture.get(StorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    userRepository = dataSource.getRepository(User);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await removeCreatedObjects();
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await removeCreatedObjects();
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function removeCreatedObjects(): Promise<void> {
    await Promise.all(
      [...createdStorageKeys].map((Key) =>
        s3Client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key })),
      ),
    );
    createdStorageKeys.clear();
  }

  async function createChannelOwner(): Promise<ChannelOwner> {
    sequence += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `delivery_owner_${sequence}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Delivery owner ${sequence}`,
        nickname: `delivery_owner_${sequence}`,
        user_id: user.id,
      }),
    );

    return {
      accessToken: jwtService.sign({ sub: user.id, email: user.email }),
      channel,
      user,
    };
  }

  async function createReadyVideo(
    owner: ChannelOwner,
    originalFilename = 'ready-video.mp4',
  ): Promise<ReadyVideoFixture> {
    const payload = Buffer.from('0123456789'.repeat(20));
    const storageKey = `test-delivery/${randomUUID()}`;
    createdStorageKeys.add(storageKey);
    await storageService.putObject(storageKey, payload, 'video/mp4');
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: owner.channel.id,
        public_id: randomUUID(),
        status: VideoStatus.READY,
        title: 'Ready private video',
        original_filename: originalFilename,
        content_type: 'video/mp4',
        size_bytes: String(payload.length),
        storage_key: storageKey,
      }),
    );

    return { payload, video };
  }

  it('stream-requested-byte-range', async () => {
    const owner = await createChannelOwner();
    const { payload, video } = await createReadyVideo(owner);

    const response = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse(binaryParser)
      .expect(206);

    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-length': '100',
      'content-range': `bytes 0-99/${payload.length}`,
      'content-type': 'video/mp4',
    });
    expect(response.body).toEqual(payload.subarray(0, 100));
  });

  it('stream-ready-object-without-range', async () => {
    const owner = await createChannelOwner();
    const { payload, video } = await createReadyVideo(owner);

    const response = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-length': String(payload.length),
      'content-type': 'video/mp4',
    });
    expect(response.headers).not.toHaveProperty('content-range');
    expect(response.body).toEqual(payload);
  });

  it('download-as-safe-attachment', async () => {
    const owner = await createChannelOwner();
    const { payload, video } = await createReadyVideo(
      owner,
      'v\u00eddeo "private".mp4',
    );

    const response = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-disposition':
        'attachment; filename="v_deo _private_.mp4"; filename*=UTF-8\'\'v%C3%ADdeo%20%22private%22.mp4',
      'content-length': String(payload.length),
      'content-type': 'video/mp4',
    });
    expect(response.body).toEqual(payload);
    const serializedResponse = `${JSON.stringify(response.headers)}${response.body.toString('utf-8')}`;
    expect(serializedResponse).not.toContain(storage.bucket);
    expect(serializedResponse).not.toContain(video.storage_key);
    expect(serializedResponse).not.toMatch(/https?:\/\//);
  });

  it('enforce-media-ownership', async () => {
    const owner = await createChannelOwner();
    const otherOwner = await createChannelOwner();
    const { video } = await createReadyVideo(owner);
    const endpoints = ['stream', 'download'] as const;

    for (const endpoint of endpoints) {
      const unauthenticated = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/${endpoint}`)
        .expect(401);
      expect(unauthenticated.headers).not.toHaveProperty('accept-ranges');
      expect(unauthenticated.headers).not.toHaveProperty('content-range');
      expect(unauthenticated.headers).not.toHaveProperty('content-disposition');

      const denied = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/${endpoint}`)
        .set('Authorization', `Bearer ${otherOwner.accessToken}`)
        .expect(403);
      expect(denied.body).toMatchObject({
        statusCode: 403,
        error: 'VIDEO_ACCESS_DENIED',
      });
      expect(denied.headers).not.toHaveProperty('accept-ranges');
      expect(denied.headers).not.toHaveProperty('content-range');
      expect(denied.headers).not.toHaveProperty('content-disposition');
      expect(JSON.stringify(denied.body)).not.toContain(storage.bucket);
      expect(JSON.stringify(denied.body)).not.toContain(video.storage_key);
    }
  });
});
