import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';

export const VIDEO_PROCESSING_QUEUE = 'video';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: queue.host,
          port: queue.port,
        },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
