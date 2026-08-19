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
import { VideoStatus } from '../video-status.enum';
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

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    const suffix = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${suffix}@example.com`,
        password: 'hashed',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: `Video channel ${suffix}`,
        nickname: `video_channel_${suffix}`,
        user_id: user.id,
      }),
    );
  }

  async function createVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Promise<Video> {
    return videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        public_id: randomUUID(),
        title: 'Launch video',
        original_filename: 'launch.mp4',
        content_type: 'video/mp4',
        size_bytes: '1024',
        storage_key: 'videos/launch.mp4',
        ...overrides,
      }),
    );
  }

  it('should apply defaults and load its channel relation', async () => {
    const channel = await createChannel();

    const saved = await createVideo(channel.id);
    const found = await videoRepository.findOne({
      where: { id: saved.id },
      relations: ['channel'],
    });

    expect(saved.id).toBeDefined();
    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.processing_attempts).toBe(0);
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
    expect(found?.channel.id).toBe(channel.id);
  });

  it('should enforce unique public_id and the allowed size_bytes range', async () => {
    const channel = await createChannel();
    const video = await createVideo(channel.id);

    await expect(
      createVideo(channel.id, { public_id: video.public_id }),
    ).rejects.toThrow();
    await expect(
      createVideo(channel.id, { size_bytes: '0' }),
    ).rejects.toThrow();
    await expect(
      createVideo(channel.id, { size_bytes: '10000000001' }),
    ).rejects.toThrow();
  });

  it('should reject invalid statuses and cascade deletion from its channel', async () => {
    const channel = await createChannel();
    const video = await createVideo(channel.id);

    await expect(
      createVideo(channel.id, { status: 'INVALID' as VideoStatus }),
    ).rejects.toThrow();

    await channelRepository.delete(channel.id);

    expect(await videoRepository.countBy({ id: video.id })).toBe(0);
  });
});
