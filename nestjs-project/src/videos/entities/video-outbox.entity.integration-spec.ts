import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoOutbox } from './video-outbox.entity';
import { Video } from './video.entity';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  VideoOutbox,
];

describe('VideoOutbox entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let videoOutboxRepository: Repository<VideoOutbox>;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    videoOutboxRepository = dataSource.getRepository(VideoOutbox);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createVideo(): Promise<Video> {
    const suffix = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `outbox_user_${suffix}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Outbox channel ${suffix}`,
        nickname: `outbox_channel_${suffix}`,
        user_id: user.id,
      }),
    );

    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_id: randomUUID(),
        title: 'Outbox video',
        original_filename: 'outbox.mp4',
        content_type: 'video/mp4',
        size_bytes: '1024',
        storage_key: 'videos/outbox.mp4',
      }),
    );
  }

  it('should persist payload, apply defaults, and load its video relation', async () => {
    const video = await createVideo();
    const payload = { version: 1, videoId: video.id };
    const saved = await videoOutboxRepository.save(
      videoOutboxRepository.create({
        video_id: video.id,
        event_type: 'video.process',
        payload,
      }),
    );
    const found = await videoOutboxRepository.findOne({
      where: { id: saved.id },
      relations: ['video'],
    });

    expect(saved.id).toBeDefined();
    expect(saved.publish_attempts).toBe(0);
    expect(saved.occurred_at).toBeInstanceOf(Date);
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
    expect(found?.payload).toEqual(payload);
    expect(found?.video.id).toBe(video.id);
  });

  it('should enforce a unique event_type per video and reject orphaned rows', async () => {
    const video = await createVideo();
    const event = {
      video_id: video.id,
      event_type: 'video.process',
      payload: { version: 1, videoId: video.id },
    };

    await videoOutboxRepository.save(videoOutboxRepository.create(event));

    await expect(
      videoOutboxRepository.save(videoOutboxRepository.create(event)),
    ).rejects.toThrow();
    await expect(
      videoOutboxRepository.save(
        videoOutboxRepository.create({
          ...event,
          video_id: randomUUID(),
        }),
      ),
    ).rejects.toThrow();
  });

  it('should cascade deletion from its video', async () => {
    const video = await createVideo();
    const outbox = await videoOutboxRepository.save(
      videoOutboxRepository.create({
        video_id: video.id,
        event_type: 'video.process',
        payload: { version: 1, videoId: video.id },
      }),
    );

    await videoRepository.delete(video.id);

    expect(await videoOutboxRepository.countBy({ id: outbox.id })).toBe(0);
  });
});
