import { StorageKeyFactory } from './storage-key.factory';

describe('StorageKeyFactory', () => {
  const factory = new StorageKeyFactory();

  it('should generate distinct opaque video and thumbnail keys from identifiers only', () => {
    const sourceKey = factory.createVideoSourceKey('channel-123', 'video-456');
    const thumbnailKey = factory.createThumbnailKey('channel-123', 'video-456');

    expect(sourceKey).toBe('videos/channel-123/video-456/source');
    expect(thumbnailKey).toBe(
      'thumbnails/channel-123/video-456/thumbnail.jpg',
    );
    expect(sourceKey).not.toBe(thumbnailKey);
  });

  it('should not include user supplied file names or titles in generated keys', () => {
    const key = factory.createVideoSourceKey('channel-123', 'video-456');

    expect(key).not.toContain('my vacation video.mp4');
    expect(key).not.toContain('original_filename');
  });
});
