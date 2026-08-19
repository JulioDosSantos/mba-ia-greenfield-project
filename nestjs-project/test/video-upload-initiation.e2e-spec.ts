import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
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

describe('Video upload initiation (e2e)', () => {
  let app: INestApplication<App>;
  let channelRepository: Repository<Channel>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let storageService: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let userRepository: Repository<User>;
  let videoRepository: Repository<Video>;
  let sequence = 0;

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
    jwtService = moduleFixture.get(JwtService);
    storageService = moduleFixture.get(StorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await abortPersistedMultipartUploads();
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await abortPersistedMultipartUploads();
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function abortPersistedMultipartUploads(): Promise<void> {
    const activeDrafts = await videoRepository.find({
      where: { status: VideoStatus.DRAFT },
    });

    await Promise.all(
      activeDrafts
        .filter(
          (video) =>
            video.multipart_upload_id !== null &&
            video.multipart_expires_at !== null,
        )
        .map((video) =>
          storageService.abortMultipartUpload(
            video.storage_key,
            video.multipart_upload_id!,
          ),
        ),
    );
  }

  async function createChannelOwner(): Promise<ChannelOwner> {
    sequence += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `upload_owner_${sequence}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Upload owner ${sequence}`,
        nickname: `upload_owner_${sequence}`,
        user_id: user.id,
      }),
    );

    return {
      accessToken: jwtService.sign({ sub: user.id, email: user.email }),
      channel,
      user,
    };
  }

  it('create-draft-without-storage-key', async () => {
    const owner = await createChannelOwner();

    const response = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: 'launch.mp4',
        title: 'Launch video',
        content_type: 'video/mp4',
        size_bytes: 1_024,
      })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      public_id: expect.any(String),
      status: 'DRAFT',
      part_size_bytes: 5_242_880,
      upload_expires_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(response.body.upload_expires_at))).toBe(
      false,
    );

    const draft = await videoRepository.findOneBy({ id: response.body.id });
    expect(draft).not.toBeNull();
    expect(draft).toMatchObject({
      channel_id: owner.channel.id,
      public_id: response.body.public_id,
      status: VideoStatus.DRAFT,
    });
  });

  it('reject-declared-size-above-10-gb', async () => {
    const owner = await createChannelOwner();

    const response = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: 'too-large.mp4',
        title: 'Too large video',
        content_type: 'video/mp4',
        size_bytes: 10_000_000_001,
      })
      .expect(413);

    expect(response.body).toMatchObject({
      statusCode: 413,
      error: 'VIDEO_SIZE_LIMIT_EXCEEDED',
    });
    expect(await videoRepository.count()).toBe(0);
  });

  it('accept-declared-size-at-exactly-10-gb', async () => {
    const owner = await createChannelOwner();

    const response = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: 'boundary.mp4',
        title: 'Boundary video',
        content_type: 'video/mp4',
        size_bytes: 10_000_000_000,
      })
      .expect(201);

    expect(
      await videoRepository.findOneBy({ id: response.body.id }),
    ).toMatchObject({ size_bytes: '10000000000' });
  });

  it('sign-distinct-multipart-parts', async () => {
    const owner = await createChannelOwner();
    const createResponse = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: 'parts.webm',
        title: 'Multipart parts',
        content_type: 'video/webm',
        size_bytes: 2_048,
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(
        `/channels/${owner.channel.id}/videos/${createResponse.body.id}/upload-parts`,
      )
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ part_numbers: [1, 2] })
      .expect(200);

    expect(response.body.parts).toHaveLength(2);
    expect(response.body.parts).toEqual([
      {
        part_number: 1,
        url: expect.any(String),
        expires_at: expect.any(String),
      },
      {
        part_number: 2,
        url: expect.any(String),
        expires_at: expect.any(String),
      },
    ]);
    for (const part of response.body.parts) {
      expect(Number.isNaN(Date.parse(part.expires_at))).toBe(false);
      expect(new URL(part.url).searchParams.get('X-Amz-Expires')).toBe('900');
    }
  });

  it('deny-non-owner-before-signing', async () => {
    const owner = await createChannelOwner();
    const otherOwner = await createChannelOwner();
    const createResponse = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: 'owner-only.mov',
        title: 'Owner only draft',
        content_type: 'video/quicktime',
        size_bytes: 4_096,
      })
      .expect(201);

    const createAsNonOwner = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${otherOwner.accessToken}`)
      .send({
        original_filename: 'forbidden.mp4',
        title: 'Forbidden draft',
        content_type: 'video/mp4',
        size_bytes: 1_024,
      })
      .expect(403);

    expect(createAsNonOwner.body).toMatchObject({
      statusCode: 403,
      error: 'CHANNEL_ACCESS_DENIED',
    });
    expect(await videoRepository.count()).toBe(1);

    const signAsNonOwner = await request(app.getHttpServer())
      .post(
        `/channels/${owner.channel.id}/videos/${createResponse.body.id}/upload-parts`,
      )
      .set('Authorization', `Bearer ${otherOwner.accessToken}`)
      .send({ part_numbers: [1] })
      .expect(403);

    expect(signAsNonOwner.body).toMatchObject({
      statusCode: 403,
      error: 'CHANNEL_ACCESS_DENIED',
    });
    expect(signAsNonOwner.body).not.toHaveProperty('parts');
  });
});
