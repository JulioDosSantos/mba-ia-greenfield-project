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
import { VideoDeliveryController } from './video-delivery.controller';
import { VideoDeliveryService } from './video-delivery.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, VideoOutbox, Channel]),
    QueueModule,
    StorageModule,
  ],
  controllers: [VideosController, VideoDeliveryController],
  providers: [
    StorageKeyFactory,
    VideoOutboxRepository,
    VideoOutboxPublisher,
    VideosRepository,
    VideoDeliveryService,
    VideosService,
  ],
  exports: [VideosService],
})
export class VideosModule {}
