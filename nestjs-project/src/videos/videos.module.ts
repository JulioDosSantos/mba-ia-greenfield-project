import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { StorageKeyFactory } from '../storage/storage-key.factory';
import { VideoOutbox } from './entities/video-outbox.entity';
import { Video } from './entities/video.entity';
import { VideoOutboxRepository } from './repositories/video-outbox.repository';
import { VideosRepository } from './repositories/videos.repository';
import { VideoOutboxPublisher } from './video-outbox.publisher';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, VideoOutbox, Channel]),
    QueueModule,
    StorageModule,
  ],
  providers: [
    StorageKeyFactory,
    VideoOutboxRepository,
    VideoOutboxPublisher,
    VideosRepository,
    VideosService,
  ],
  exports: [VideosService],
})
export class VideosModule {}
