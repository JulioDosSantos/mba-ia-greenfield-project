import { Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { StorageKeyFactory } from '../storage/storage-key.factory';
import { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';

type FfprobeStream = {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
};

type FfprobeOutput = {
  format?: {
    duration?: unknown;
    format_name?: unknown;
  };
  streams?: FfprobeStream[];
};

export type ProcessedVideoMedia = {
  durationSeconds: number;
  metadata: Record<string, unknown>;
  thumbnailKey: string;
};

const COMMAND_OUTPUT_LIMIT_BYTES = 1_000_000;

@Injectable()
export class VideoMediaProcessorService {
  constructor(
    private readonly storageService: StorageService,
    private readonly storageKeyFactory: StorageKeyFactory,
  ) {}

  async process(video: Video): Promise<ProcessedVideoMedia> {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'streamtube-video-'),
    );
    const sourcePath = join(temporaryDirectory, 'source');
    const thumbnailPath = join(temporaryDirectory, 'thumbnail.jpg');

    try {
      const sourceObject = await this.storageService.getObject(
        video.storage_key,
      );
      await pipeline(sourceObject.Body, createWriteStream(sourcePath));

      const probe = await this.probe(sourcePath);
      await this.createThumbnail(sourcePath, thumbnailPath);

      const thumbnailKey = this.storageKeyFactory.createThumbnailKey(
        video.channel_id,
        video.id,
      );
      await this.storageService.putObject(
        thumbnailKey,
        await readFile(thumbnailPath),
        'image/jpeg',
      );

      return {
        durationSeconds: probe.durationSeconds,
        metadata: probe.metadata,
        thumbnailKey,
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async probe(sourcePath: string): Promise<{
    durationSeconds: number;
    metadata: Record<string, unknown>;
  }> {
    const output = await this.runCommand('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,width,height',
      sourcePath,
    ]);

    let probe: FfprobeOutput;
    try {
      probe = JSON.parse(output) as FfprobeOutput;
    } catch {
      throw new Error('Unable to read media metadata');
    }

    const duration = this.toFiniteNumber(probe.format?.duration);
    if (duration === null || duration < 0) {
      throw new Error('Media duration is invalid');
    }

    const videoStream = probe.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    if (!videoStream) {
      throw new Error('Media has no video stream');
    }

    const metadata: Record<string, unknown> = {};
    const containerFormat = this.toSafeString(probe.format?.format_name);
    const videoCodec = this.toSafeString(videoStream.codec_name);
    const width = this.toPositiveInteger(videoStream.width);
    const height = this.toPositiveInteger(videoStream.height);

    if (containerFormat) {
      metadata.container_format = containerFormat;
    }
    if (videoCodec) {
      metadata.video_codec = videoCodec;
    }
    if (width !== null) {
      metadata.width = width;
    }
    if (height !== null) {
      metadata.height = height;
    }

    return {
      durationSeconds: Math.ceil(duration),
      metadata,
    };
  }

  private async createThumbnail(
    sourcePath: string,
    thumbnailPath: string,
  ): Promise<void> {
    await this.runCommand('ffmpeg', [
      '-y',
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=320:-2',
      '-q:v',
      '2',
      thumbnailPath,
    ]);
  }

  private async runCommand(
    command: string,
    arguments_: readonly string[],
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const childProcess = spawn(command, arguments_, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      let outputLength = 0;
      let settled = false;

      const settle = (callback: () => void): void => {
        if (!settled) {
          settled = true;
          callback();
        }
      };

      childProcess.stdout.on('data', (chunk: Buffer) => {
        if (outputLength >= COMMAND_OUTPUT_LIMIT_BYTES) {
          return;
        }

        const remainingLength = COMMAND_OUTPUT_LIMIT_BYTES - outputLength;
        const boundedChunk = chunk.subarray(0, remainingLength);
        chunks.push(boundedChunk);
        outputLength += boundedChunk.length;
      });
      childProcess.once('error', () => {
        settle(() => reject(new Error('Media command could not be started')));
      });
      childProcess.once('close', (code) => {
        if (code !== 0) {
          settle(() => reject(new Error('Media command failed')));
          return;
        }

        settle(() => resolve(Buffer.concat(chunks).toString('utf8')));
      });
    });
  }

  private toFiniteNumber(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(parsed) ? parsed : null;
  }

  private toPositiveInteger(value: unknown): number | null {
    const parsed = this.toFiniteNumber(value);
    return parsed !== null && Number.isInteger(parsed) && parsed > 0
      ? parsed
      : null;
  }

  private toSafeString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= 255
      ? value
      : null;
  }
}
