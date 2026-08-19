import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import databaseConfig from '../config/database.config';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { envValidationSchema } from '../config/env.validation';
import { QueueModule } from '../queue/queue.module';
import { StorageKeyFactory } from '../storage/storage-key.factory';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { VideoOutbox } from './entities/video-outbox.entity';
import { Video } from './entities/video.entity';
import { VideosRepository } from './repositories/videos.repository';
import { VideoMediaProcessorService } from './video-media-processor.service';
import { VideoUploadCleanupService } from './video-upload-cleanup.service';
import { VideoWorkerProcessor } from './video-worker.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, queueConfig, storageConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (database: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: database.host,
        port: database.port,
        username: database.username,
        password: database.password,
        database: database.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video, VideoOutbox, Channel, User]),
    QueueModule,
    StorageModule,
  ],
  providers: [
    StorageKeyFactory,
    VideosRepository,
    VideoMediaProcessorService,
    VideoWorkerProcessor,
    VideoUploadCleanupService,
  ],
})
export class VideoWorkerModule {}
