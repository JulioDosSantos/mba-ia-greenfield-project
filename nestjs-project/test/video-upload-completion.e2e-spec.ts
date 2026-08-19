import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import storageConfig from '../src/config/storage.config';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { VideoOutbox } from '../src/videos/entities/video-outbox.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import { VIDEO_PROCESSING_QUEUE } from '../src/queue/queue.module';
import { VideosService } from '../src/videos/videos.service';

type ChannelOwner = {
  accessToken: string;
  channel: Channel;
  user: User;
};

type MultipartDraft = {
  eTag: string;
  id: string;
  storageKey: string;
};

describe('Video upload completion (e2e)', () => {
  let app: INestApplication<App>;
  let channelRepository: Repository<Channel>;
  let createdStorageKeys: Set<string>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let s3Client: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  let storageService: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let userRepository: Repository<User>;
  let videoQueue: Queue;
  let videoOutboxRepository: Repository<VideoOutbox>;
  let videoRepository: Repository<Video>;
  let videosService: VideosService;
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
    videoOutboxRepository = dataSource.getRepository(VideoOutbox);
    videoRepository = dataSource.getRepository(Video);
    videoQueue = moduleFixture.get<Queue>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    videosService = moduleFixture.get(VideosService);
    createdStorageKeys = new Set();
  });

  afterAll(async () => {
    await cleanStorageAndDrafts();
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await cleanStorageAndDrafts();
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function cleanStorageAndDrafts(): Promise<void> {
    await Promise.all(
      [...createdStorageKeys].map((Key) =>
        s3Client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key })),
      ),
    );
    createdStorageKeys.clear();

    const activeDrafts = await videoRepository.find({
      where: { status: VideoStatus.DRAFT },
    });
    await Promise.all(
      activeDrafts
        .filter((video) => video.multipart_upload_id !== null)
        .map(async (video) => {
          const channel = await channelRepository.findOneByOrFail({
            id: video.channel_id,
          });
          await videosService.cancelUpload(
            channel.user_id,
            channel.id,
            video.id,
          );
        }),
    );
  }

  async function createChannelOwner(): Promise<ChannelOwner> {
    sequence += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `completion_owner_${sequence}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Completion owner ${sequence}`,
        nickname: `completion_owner_${sequence}`,
        user_id: user.id,
      }),
    );

    return {
      accessToken: jwtService.sign({ sub: user.id, email: user.email }),
      channel,
      user,
    };
  }

  async function createUploadDraft(owner: ChannelOwner): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: 'completion.mp4',
        title: 'Upload completion',
        content_type: 'video/mp4',
        size_bytes: 1_024,
      })
      .expect(201);

    return response.body.id;
  }

  async function createMultipartDraft(
    owner: ChannelOwner,
  ): Promise<MultipartDraft> {
    const id = await createUploadDraft(owner);
    const signed = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/${id}/upload-parts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ part_numbers: [1] })
      .expect(200);
    const uploadResponse = await fetch(signed.body.parts[0].url, {
      method: 'PUT',
      body: Uint8Array.from(Buffer.from('valid multipart part')),
    });
    const eTag = uploadResponse.headers.get('etag');

    expect(uploadResponse.ok).toBe(true);
    expect(eTag).not.toBeNull();

    const draft = await videoRepository.findOneByOrFail({ id });
    createdStorageKeys.add(draft.storage_key);
    return { eTag: eTag!, id, storageKey: draft.storage_key };
  }

  it('complete-valid-upload-and-queue-processing', async () => {
    const owner = await createChannelOwner();
    const draft = await createMultipartDraft(owner);

    const response = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/${draft.id}/complete-upload`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ parts: [{ part_number: 1, e_tag: draft.eTag }] })
      .expect(202);

    expect(response.body).toEqual({
      id: draft.id,
      public_id: expect.any(String),
      status: 'DRAFT',
      processing_queued: true,
    });
    const persistedVideo = await videoRepository.findOneByOrFail({
      id: draft.id,
    });
    expect([
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      VideoStatus.ERROR,
    ]).toContain(persistedVideo.status);
    expect(persistedVideo).toMatchObject({
      multipart_upload_id: null,
      multipart_expires_at: null,
    });
    expect(
      await videoOutboxRepository.countBy({
        video_id: draft.id,
        event_type: 'video.process',
      }),
    ).toBe(1);
    expect(await videoQueue.getJob(draft.id)).not.toBeNull();
  });

  it('reject-invalid-parts-and-oversize-confirmed-object', async () => {
    const owner = await createChannelOwner();
    const invalidDraftId = await createUploadDraft(owner);
    const invalidParts = await request(app.getHttpServer())
      .post(
        `/channels/${owner.channel.id}/videos/${invalidDraftId}/complete-upload`,
      )
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        parts: [
          { part_number: 2, e_tag: 'etag-2' },
          { part_number: 1, e_tag: 'etag-1' },
        ],
      })
      .expect(422);

    expect(invalidParts.body).toMatchObject({
      statusCode: 422,
      error: 'MULTIPART_COMPLETION_INVALID',
    });
    expect(
      await videoOutboxRepository.countBy({ video_id: invalidDraftId }),
    ).toBe(0);
    expect(await videoQueue.getJob(invalidDraftId)).toBeUndefined();

    const oversizedDraft = await createMultipartDraft(owner);
    const headObjectSpy = jest
      .spyOn(storageService, 'headObject')
      .mockResolvedValueOnce({
        ContentLength: 10_000_000_001,
        ContentType: 'video/mp4',
      });

    try {
      const oversized = await request(app.getHttpServer())
        .post(
          `/channels/${owner.channel.id}/videos/${oversizedDraft.id}/complete-upload`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ parts: [{ part_number: 1, e_tag: oversizedDraft.eTag }] })
        .expect(413);

      expect(oversized.body).toMatchObject({
        statusCode: 413,
        error: 'VIDEO_SIZE_LIMIT_EXCEEDED',
      });
    } finally {
      headObjectSpy.mockRestore();
    }

    expect(
      await videoOutboxRepository.countBy({ video_id: oversizedDraft.id }),
    ).toBe(0);
    expect(await videoQueue.getJob(oversizedDraft.id)).toBeUndefined();
    expect(
      await videoRepository.findOneBy({ id: oversizedDraft.id }),
    ).toBeNull();
    await expect(
      storageService.headObject(oversizedDraft.storageKey),
    ).rejects.toBeDefined();
  });

  it('keep-completion-idempotent', async () => {
    const owner = await createChannelOwner();
    const draft = await createMultipartDraft(owner);
    const body = { parts: [{ part_number: 1, e_tag: draft.eTag }] };

    const first = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/${draft.id}/complete-upload`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(body)
      .expect(202);
    const duplicate = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/${draft.id}/complete-upload`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(body)
      .expect(202);

    expect(first.body).toEqual({
      id: draft.id,
      public_id: expect.any(String),
      status: 'DRAFT',
      processing_queued: true,
    });
    expect(duplicate.body).toEqual(first.body);
    expect(
      await videoOutboxRepository.countBy({
        video_id: draft.id,
        event_type: 'video.process',
      }),
    ).toBe(1);
    expect(await videoQueue.getJob(draft.id)).not.toBeNull();
  });

  it('cancel-only-owner-draft', async () => {
    const owner = await createChannelOwner();
    const otherOwner = await createChannelOwner();
    const draftId = await createUploadDraft(owner);

    const denied = await request(app.getHttpServer())
      .delete(`/channels/${owner.channel.id}/videos/${draftId}/upload`)
      .set('Authorization', `Bearer ${otherOwner.accessToken}`)
      .expect(403);

    expect(denied.body).toMatchObject({
      statusCode: 403,
      error: 'CHANNEL_ACCESS_DENIED',
    });
    expect(await videoRepository.findOneBy({ id: draftId })).not.toBeNull();

    await request(app.getHttpServer())
      .delete(`/channels/${owner.channel.id}/videos/${draftId}/upload`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    expect(await videoRepository.findOneBy({ id: draftId })).toBeNull();
  });
});
