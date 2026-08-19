import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Response as SuperAgentResponse } from 'superagent';
import type { Job, Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import storageConfig from '../src/config/storage.config';
import { VIDEO_PROCESSING_QUEUE } from '../src/queue/queue.module';
import { StorageService } from '../src/storage/storage.service';
import {
  createSmallMp4Fixture,
  type VideoFixture,
  uploadPresignedPart,
  waitForVideoStatus,
} from '../src/test/video-fixtures';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { VideoOutbox } from '../src/videos/entities/video-outbox.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VIDEO_PROCESS_EVENT_TYPE } from '../src/videos/repositories/video-outbox.repository';
import { VideoStatus } from '../src/videos/video-status.enum';
import type { VideoProcessJob } from '../src/videos/video-outbox.publisher';
import { VideosService } from '../src/videos/videos.service';

const POLL_INTERVAL_MS = 100;
const JOB_TIMEOUT_MS = 45_000;

type ChannelOwner = {
  accessToken: string;
  channel: Channel;
  user: User;
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

describe('Video pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let channelRepository: Repository<Channel>;
  let dataSource: DataSource;
  let fixture: VideoFixture;
  let jwtService: JwtService;
  let s3Client: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  let storageService: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let userRepository: Repository<User>;
  let videoOutboxRepository: Repository<VideoOutbox>;
  let videoQueue: Queue<VideoProcessJob>;
  let videoRepository: Repository<Video>;
  let videosService: VideosService;
  let sequence = 0;
  const createdStorageKeys = new Set<string>();
  const createdJobIds = new Set<string>();

  beforeAll(async () => {
    fixture = await createSmallMp4Fixture();
    expect(fixture.bytes.length).toBeGreaterThan(100);

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
    videoQueue = moduleFixture.get<Queue<VideoProcessJob>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    videoRepository = dataSource.getRepository(Video);
    videosService = moduleFixture.get(VideosService);
  }, 60_000);

  afterAll(async () => {
    await cleanTestState();
    await app.close();
    await fixture.dispose();
  });

  beforeEach(async () => {
    await cleanTestState();
    throttlerStorage.storage.clear();
  });

  async function cleanTestState(): Promise<void> {
    const persistedVideos = await videoRepository.find();
    for (const video of persistedVideos) {
      createdStorageKeys.add(video.storage_key);
      if (video.thumbnail_key) {
        createdStorageKeys.add(video.thumbnail_key);
      }
    }

    await Promise.all(
      persistedVideos
        .filter(
          (video) =>
            video.status === VideoStatus.DRAFT &&
            video.multipart_upload_id !== null,
        )
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
    await removeCreatedJobs();
    await removeCreatedObjects();
    await cleanAllTables(dataSource);
  }

  async function removeCreatedJobs(): Promise<void> {
    await Promise.all(
      [...createdJobIds].map(async (jobId) => {
        const job = await videoQueue.getJob(jobId);
        await job?.remove();
      }),
    );
    createdJobIds.clear();
  }

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
        email: `pipeline_owner_${sequence}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Pipeline owner ${sequence}`,
        nickname: `pipeline_owner_${sequence}`,
        user_id: user.id,
      }),
    );

    return {
      accessToken: jwtService.sign({ sub: user.id, email: user.email }),
      channel,
      user,
    };
  }

  async function createUploadDraft(
    owner: ChannelOwner,
    sizeBytes: number,
    originalFilename = 'pipeline.mp4',
  ): Promise<Video> {
    const response = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: originalFilename,
        title: 'Pipeline upload',
        content_type: 'video/mp4',
        size_bytes: sizeBytes,
      })
      .expect(201);
    const draft = await videoRepository.findOneByOrFail({
      id: response.body.id,
    });
    createdStorageKeys.add(draft.storage_key);
    return draft;
  }

  async function uploadPart(
    owner: ChannelOwner,
    draft: Video,
    bytes: Buffer,
  ): Promise<string> {
    const signed = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/${draft.id}/upload-parts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ part_numbers: [1] })
      .expect(200);

    return uploadPresignedPart(signed.body.parts[0].url, bytes);
  }

  async function completeUpload(
    owner: ChannelOwner,
    draft: Video,
    eTag: string,
  ) {
    createdJobIds.add(draft.id);
    return request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/${draft.id}/complete-upload`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ parts: [{ part_number: 1, e_tag: eTag }] })
      .expect(202);
  }

  async function waitForJob(jobId: string): Promise<Job<VideoProcessJob>> {
    const deadline = Date.now() + JOB_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const job = await videoQueue.getJob(jobId);
      if (job) {
        return job;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }

    throw new Error('Timed out waiting for video processing job');
  }

  async function waitForJobState(
    jobId: string,
    expectedState: string,
  ): Promise<Job<VideoProcessJob>> {
    const deadline = Date.now() + JOB_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const job = await videoQueue.getJob(jobId);
      if (job && (await job.getState()) === expectedState) {
        return job;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }

    throw new Error(`Timed out waiting for job state ${expectedState}`);
  }

  it('process-direct-upload-to-ready', async () => {
    const owner = await createChannelOwner();
    const draft = await createUploadDraft(owner, fixture.bytes.length);
    const eTag = await uploadPart(owner, draft, fixture.bytes);

    await completeUpload(owner, draft, eTag);

    const outboxEvents = await videoOutboxRepository.findBy({
      video_id: draft.id,
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      event_type: VIDEO_PROCESS_EVENT_TYPE,
      payload: { version: 1, videoId: draft.id },
      published_at: expect.any(Date),
    });
    await expect(waitForJob(draft.id)).resolves.toMatchObject({
      name: VIDEO_PROCESS_EVENT_TYPE,
      data: { version: 1, videoId: draft.id },
    });

    const readyVideo = await waitForVideoStatus(
      videoRepository,
      draft.id,
      VideoStatus.READY,
    );
    createdStorageKeys.add(readyVideo.thumbnail_key!);
    expect(readyVideo).toMatchObject({
      status: VideoStatus.READY,
      duration_seconds: expect.any(Number),
      metadata: expect.objectContaining({
        container_format: expect.any(String),
        video_codec: expect.any(String),
        width: 64,
        height: 64,
      }),
      thumbnail_key: expect.any(String),
    });
    expect(readyVideo.duration_seconds).toBeGreaterThanOrEqual(1);
    await expect(
      storageService.headObject(readyVideo.thumbnail_key!),
    ).resolves.toEqual(
      expect.objectContaining({
        ContentLength: expect.any(Number),
        ContentType: 'image/jpeg',
      }),
    );
    expect((await waitForJobState(draft.id, 'completed')).attemptsMade).toBe(1);
  }, 60_000);

  it('reject-over-limit-without-api-body-transfer', async () => {
    const owner = await createChannelOwner();

    const declaredLimit = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/uploads`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        original_filename: 'too-large.mp4',
        title: 'Over limit',
        content_type: 'video/mp4',
        size_bytes: 10_000_000_001,
      })
      .expect(413);
    expect(declaredLimit.body).toMatchObject({
      statusCode: 413,
      error: 'VIDEO_SIZE_LIMIT_EXCEEDED',
    });
    expect(await videoRepository.count()).toBe(0);

    const draft = await createUploadDraft(owner, fixture.bytes.length);
    const eTag = await uploadPart(owner, draft, fixture.bytes);
    const headObjectSpy = jest
      .spyOn(storageService, 'headObject')
      .mockResolvedValueOnce({
        ContentLength: 10_000_000_001,
        ContentType: 'video/mp4',
      });

    try {
      const confirmedLimit = await request(app.getHttpServer())
        .post(
          `/channels/${owner.channel.id}/videos/${draft.id}/complete-upload`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ parts: [{ part_number: 1, e_tag: eTag }] })
        .expect(413);
      expect(confirmedLimit.body).toMatchObject({
        statusCode: 413,
        error: 'VIDEO_SIZE_LIMIT_EXCEEDED',
      });
    } finally {
      headObjectSpy.mockRestore();
    }

    expect(await videoOutboxRepository.countBy({ video_id: draft.id })).toBe(0);
    expect(await videoQueue.getJob(draft.id)).toBeUndefined();
    expect(await videoRepository.findOneBy({ id: draft.id })).toBeNull();
    await expect(
      storageService.headObject(draft.storage_key),
    ).rejects.toBeDefined();
  });

  it('retry-invalid-media-and-ignore-duplicate-job', async () => {
    const owner = await createChannelOwner();
    const invalidMedia = Buffer.from('not a media container');
    const draft = await createUploadDraft(
      owner,
      invalidMedia.length,
      'invalid.mp4',
    );
    const eTag = await uploadPart(owner, draft, invalidMedia);

    await completeUpload(owner, draft, eTag);

    const failedVideo = await waitForVideoStatus(
      videoRepository,
      draft.id,
      VideoStatus.ERROR,
    );
    expect(failedVideo).toMatchObject({
      status: VideoStatus.ERROR,
      error_code: 'VIDEO_PROCESSING_FAILED',
      metadata: null,
      thumbnail_key: null,
      processing_attempts: 3,
    });
    expect((await waitForJobState(draft.id, 'failed')).attemptsMade).toBe(3);

    const duplicateJobId = `${draft.id}-duplicate`;
    createdJobIds.add(duplicateJobId);
    await videoQueue.add(
      VIDEO_PROCESS_EVENT_TYPE,
      { version: 1, videoId: draft.id },
      { jobId: duplicateJobId, attempts: 1 },
    );
    await waitForJobState(duplicateJobId, 'completed');

    await expect(
      videoRepository.findOneByOrFail({ id: draft.id }),
    ).resolves.toMatchObject({
      status: VideoStatus.ERROR,
      error_code: 'VIDEO_PROCESSING_FAILED',
      metadata: null,
      thumbnail_key: null,
      processing_attempts: 3,
    });
  }, 60_000);

  it('deliver-ready-media-through-http', async () => {
    const owner = await createChannelOwner();
    const draft = await createUploadDraft(
      owner,
      fixture.bytes.length,
      'pipeline "ready".mp4',
    );
    const eTag = await uploadPart(owner, draft, fixture.bytes);
    await completeUpload(owner, draft, eTag);
    const readyVideo = await waitForVideoStatus(
      videoRepository,
      draft.id,
      VideoStatus.READY,
    );
    createdStorageKeys.add(readyVideo.thumbnail_key!);

    const stream = await request(app.getHttpServer())
      .get(`/videos/${readyVideo.public_id}/stream`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse(binaryParser)
      .expect(206);
    expect(stream.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-length': '100',
      'content-range': `bytes 0-99/${fixture.bytes.length}`,
      'content-type': 'video/mp4',
    });
    expect(stream.body).toEqual(fixture.bytes.subarray(0, 100));

    const download = await request(app.getHttpServer())
      .get(`/videos/${readyVideo.public_id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(download.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-disposition':
        'attachment; filename="pipeline _ready_.mp4"; filename*=UTF-8\'\'pipeline%20%22ready%22.mp4',
      'content-length': String(fixture.bytes.length),
      'content-type': 'video/mp4',
    });
    expect(download.body).toEqual(fixture.bytes);
    const serializedResponse = `${JSON.stringify(download.headers)}${download.body.toString('utf8')}`;
    expect(download.headers).not.toHaveProperty('location');
    expect(serializedResponse).not.toContain(storage.endpoint);
    expect(serializedResponse).not.toContain(storage.bucket);
    expect(serializedResponse).not.toContain(readyVideo.storage_key);
  }, 60_000);

  it('deny-non-owner-across-upload-and-delivery', async () => {
    const owner = await createChannelOwner();
    const otherOwner = await createChannelOwner();
    const draft = await createUploadDraft(owner, fixture.bytes.length);

    const deniedCompletion = await request(app.getHttpServer())
      .post(`/channels/${owner.channel.id}/videos/${draft.id}/complete-upload`)
      .set('Authorization', `Bearer ${otherOwner.accessToken}`)
      .send({ parts: [{ part_number: 1, e_tag: 'not-used' }] })
      .expect(403);
    expect(deniedCompletion.body).toMatchObject({
      statusCode: 403,
      error: 'CHANNEL_ACCESS_DENIED',
    });

    const storageKey = `test-private/${randomUUID()}`;
    createdStorageKeys.add(storageKey);
    await storageService.putObject(storageKey, fixture.bytes, 'video/mp4');
    const readyVideo = await videoRepository.save(
      videoRepository.create({
        channel_id: owner.channel.id,
        public_id: randomUUID(),
        status: VideoStatus.READY,
        title: 'Owner-only video',
        original_filename: 'owner-only.mp4',
        content_type: 'video/mp4',
        size_bytes: String(fixture.bytes.length),
        storage_key: storageKey,
      }),
    );

    for (const endpoint of ['stream', 'download'] as const) {
      const deniedDelivery = await request(app.getHttpServer())
        .get(`/videos/${readyVideo.public_id}/${endpoint}`)
        .set('Authorization', `Bearer ${otherOwner.accessToken}`)
        .expect(403);
      expect(deniedDelivery.body).toMatchObject({
        statusCode: 403,
        error: 'VIDEO_ACCESS_DENIED',
      });
      expect(deniedDelivery.headers).not.toHaveProperty('accept-ranges');
      expect(deniedDelivery.headers).not.toHaveProperty('content-range');
      expect(deniedDelivery.headers).not.toHaveProperty('content-disposition');
      expect(JSON.stringify(deniedDelivery.body)).not.toContain(storage.bucket);
      expect(JSON.stringify(deniedDelivery.body)).not.toContain(storageKey);
    }
  });
});
