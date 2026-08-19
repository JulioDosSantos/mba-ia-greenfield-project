import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3Client,
      inject: [storageConfig.KEY],
      useFactory: (storage: ConfigType<typeof storageConfig>): S3Client => {
        if (!storage.accessKeyId || !storage.secretAccessKey) {
          throw new Error('Storage credentials are not configured');
        }

        return new S3Client({
          endpoint: storage.endpoint,
          region: storage.region,
          credentials: {
            accessKeyId: storage.accessKeyId,
            secretAccessKey: storage.secretAccessKey,
          },
          forcePathStyle: true,
        });
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
