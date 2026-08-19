import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import { QueueModule, VIDEO_PROCESSING_QUEUE } from '../queue/queue.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoOutbox } from './entities/video-outbox.entity';
import { Video } from './entities/video.entity';
import {
  VIDEO_PROCESS_EVENT_TYPE,
  VideoOutboxRepository,
} from './repositories/video-outbox.repository';
import { VideoStatus } from './video-status.enum';
import {
  type VideoProcessJob,
  VideoOutboxPublisher,
} from './video-outbox.publisher';

const ALL_ENTITIES = [User, Channel, RefreshToken, Video, VideoOutbox];

describe('VideoOutboxPublisher (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let outboxRepository: Repository<VideoOutbox>;
  let publisher: VideoOutboxPublisher;
  let videoQueue: Queue<VideoProcessJob>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([VideoOutbox]),
        QueueModule,
      ],
      providers: [VideoOutboxRepository, VideoOutboxPublisher],
    }).compile();

    dataSource = module.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    outboxRepository = dataSource.getRepository(VideoOutbox);
    publisher = module.get(VideoOutboxPublisher);
    videoQueue = module.get<Queue<VideoProcessJob>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await videoQueue.obliterate({ force: true });
    await cleanAllTables(dataSource);
  });

  async function createPendingOutbox(): Promise<VideoOutbox> {
    const user = await userRepository.save(
      userRepository.create({
        email: `outbox_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Outbox channel',
        nickname: `outbox_${randomUUID()}`,
        user_id: user.id,
      }),
    );
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_id: randomUUID(),
        status: VideoStatus.DRAFT,
        title: 'Queued video',
        original_filename: 'queued-video.mp4',
        content_type: 'video/mp4',
        size_bytes: '1024',
        storage_key: `videos/${channel.id}/${randomUUID()}/source`,
      }),
    );

    return outboxRepository.save(
      outboxRepository.create({
        video_id: video.id,
        event_type: VIDEO_PROCESS_EVENT_TYPE,
        payload: { version: 1, videoId: video.id },
      }),
    );
  }

  it('delivers one versioned job to Redis and recovers a pending outbox row without duplicating the job', async () => {
    const outbox = await createPendingOutbox();

    await expect(publisher.publishPending()).resolves.toBe(1);

    const firstJob = await videoQueue.getJob(outbox.video_id);
    expect(firstJob).toBeDefined();
    expect(firstJob?.name).toBe(VIDEO_PROCESS_EVENT_TYPE);
    expect(firstJob?.data).toEqual({ version: 1, videoId: outbox.video_id });
    expect(
      (await outboxRepository.findOneByOrFail({ id: outbox.id })).published_at,
    ).not.toBeNull();

    await outboxRepository.update(outbox.id, { published_at: null });

    await expect(publisher.publishPending()).resolves.toBe(1);

    expect(await videoQueue.getWaiting()).toHaveLength(1);
    expect(
      (await outboxRepository.findOneByOrFail({ id: outbox.id })).published_at,
    ).not.toBeNull();
  }, 30000);
});
