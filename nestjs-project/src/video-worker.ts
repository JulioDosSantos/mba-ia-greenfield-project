import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { VideoWorkerModule } from './videos/video-worker.module';

async function bootstrap(): Promise<void> {
  const worker = await NestFactory.createApplicationContext(VideoWorkerModule);
  worker.enableShutdownHooks(['SIGINT', 'SIGTERM']);
}

void bootstrap().catch(() => {
  Logger.error('Video worker failed to start');
  process.exitCode = 1;
});
