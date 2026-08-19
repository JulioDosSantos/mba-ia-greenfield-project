import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.module';
import { StorageKeyFactory } from '../storage/storage-key.factory';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VIDEO_PROCESS_EVENT_TYPE } from './repositories/video-outbox.repository';
import { VideoStatus } from './video-status.enum';
import type { VideoProcessJob } from './video-outbox.publisher';
import { VideoWorkerModule } from './video-worker.module';

const execFileAsync = promisify(execFile);
const STORAGE_BUCKET = 'streamtube-media';
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

describe('VideoWorkerProcessor (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let storageKeyFactory: StorageKeyFactory;
  let storageClient: S3Client;
  let videoQueue: Queue<VideoProcessJob>;
  let fixtureDirectory: string;
  let fixturePath: string;
  let counter = 0;
  const createdStorageKeys: string[] = [];

  beforeAll(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'streamtube-worker-test-'));
    fixturePath = join(fixtureDirectory, 'fixture.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      fixturePath,
    ]);

    module = await Test.createTestingModule({
      imports: [VideoWorkerModule],
    }).compile();
    await module.init();

    dataSource = module.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    storageService = module.get(StorageService);
    storageKeyFactory = module.get(StorageKeyFactory);
    storageClient = module.get(S3Client);
    videoQueue = module.get<Queue<VideoProcessJob>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
  }, 60_000);

  afterAll(async () => {
    await removeCreatedObjects();
    await videoQueue.obliterate({ force: true });
    await module.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await videoQueue.obliterate({ force: true });
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

  async function createVideoForProcessing(): Promise<Video> {
    counter += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_worker_${counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Video worker channel ${counter}`,
        nickname: `video_worker_channel_${counter}`,
        user_id: user.id,
      }),
    );
    const videoId = randomUUID();
    const storageKey = storageKeyFactory.createVideoSourceKey(
      channel.id,
      videoId,
    );
    createdStorageKeys.push(storageKey);
    await storageService.putObject(
      storageKey,
      await readFile(fixturePath),
      'video/mp4',
    );

    return videoRepository.save(
      videoRepository.create({
        id: videoId,
        channel_id: channel.id,
        public_id: randomUUID(),
        status: VideoStatus.DRAFT,
        title: 'Video to process',
        original_filename: 'fixture.mp4',
        content_type: 'video/mp4',
        size_bytes: '2048',
        storage_key: storageKey,
        multipart_upload_id: null,
        multipart_expires_at: null,
      }),
    );
  }

  async function waitForReady(videoId: string): Promise<Video> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const video = await videoRepository.findOneBy({ id: videoId });
      if (video?.status === VideoStatus.READY) {
        return video;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }

    throw new Error('Timed out waiting for processed video');
  }

  it('processes a real MinIO video with ffprobe and ffmpeg, then persists its private thumbnail', async () => {
    const video = await createVideoForProcessing();

    await videoQueue.add(
      VIDEO_PROCESS_EVENT_TYPE,
      { version: 1, videoId: video.id },
      {
        jobId: video.id,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    const readyVideo = await waitForReady(video.id);
    expect(readyVideo.duration_seconds).toBeGreaterThanOrEqual(1);
    expect(readyVideo.metadata).toEqual(
      expect.objectContaining({
        container_format: expect.any(String),
        video_codec: expect.any(String),
        width: 64,
        height: 64,
      }),
    );
    expect(readyVideo.thumbnail_key).toBe(
      storageKeyFactory.createThumbnailKey(video.channel_id, video.id),
    );
    createdStorageKeys.push(readyVideo.thumbnail_key!);

    await expect(
      storageService.headObject(readyVideo.thumbnail_key!),
    ).resolves.toEqual(
      expect.objectContaining({
        ContentLength: expect.any(Number),
        ContentType: 'image/jpeg',
      }),
    );
  }, 45_000);
});
