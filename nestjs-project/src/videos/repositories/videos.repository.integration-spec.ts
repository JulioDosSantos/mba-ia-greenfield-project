import { randomUUID } from 'node:crypto';
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
import { VideoOutbox } from '../entities/video-outbox.entity';
import { Video } from '../entities/video.entity';
import { VideosRepository } from './videos.repository';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  VideoOutbox,
];

describe('VideosRepository (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let videosRepository: VideosRepository;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    videosRepository = new VideosRepository(videoRepository, channelRepository);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    counter += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `videos_repository_${counter}@example.com`,
        password: 'hashed',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: `Repository channel ${counter}`,
        nickname: `repository_channel_${counter}`,
        user_id: user.id,
      }),
    );
  }

  async function createVideo(channelId: string): Promise<Video> {
    return videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        public_id: randomUUID(),
        title: 'Repository video',
        original_filename: 'repository.mp4',
        content_type: 'video/mp4',
        size_bytes: '1024',
        storage_key: `videos/${channelId}/${randomUUID()}/source`,
      }),
    );
  }

  it('scopes video lookup to its channel', async () => {
    const ownerChannel = await createChannel();
    const anotherChannel = await createChannel();
    const video = await createVideo(ownerChannel.id);

    expect(
      await videosRepository.findByIdInChannel(video.id, ownerChannel.id),
    ).toMatchObject({ id: video.id });
    expect(
      await videosRepository.findByIdInChannel(video.id, anotherChannel.id),
    ).toBeNull();
  });

  it('uses a guarded draft claim that cannot move a terminal video backwards', async () => {
    const channel = await createChannel();
    const video = await createVideo(channel.id);

    expect(await videosRepository.claimForProcessing(video.id)).toBe(true);
    expect(
      await videoRepository.findOneByOrFail({ id: video.id }),
    ).toMatchObject({
      status: VideoStatus.PROCESSING,
    });

    await videoRepository.update(video.id, { status: VideoStatus.READY });

    expect(await videosRepository.claimForProcessing(video.id)).toBe(false);
    expect(
      await videoRepository.findOneByOrFail({ id: video.id }),
    ).toMatchObject({
      status: VideoStatus.READY,
    });
  });
});
