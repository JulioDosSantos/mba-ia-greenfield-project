import { Injectable } from '@nestjs/common';

@Injectable()
export class StorageKeyFactory {
  createVideoSourceKey(channelId: string, videoId: string): string {
    return `videos/${channelId}/${videoId}/source`;
  }

  createThumbnailKey(channelId: string, videoId: string): string {
    return `thumbnails/${channelId}/${videoId}/thumbnail.jpg`;
  }
}
