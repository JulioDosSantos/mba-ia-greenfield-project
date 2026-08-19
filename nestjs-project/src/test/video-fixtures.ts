import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Repository } from 'typeorm';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/video-status.enum';

const execFileAsync = promisify(execFile);
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 45_000;

export type VideoFixture = {
  bytes: Buffer;
  dispose: () => Promise<void>;
};

export async function createSmallMp4Fixture(): Promise<VideoFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'streamtube-video-fixture-'));
  const fixturePath = join(directory, 'fixture.mp4');

  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=64x64:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    fixturePath,
  ]);

  return {
    bytes: await readFile(fixturePath),
    dispose: async (): Promise<void> =>
      rm(directory, { recursive: true, force: true }),
  };
}

export async function uploadPresignedPart(
  url: string,
  bytes: Buffer,
): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: Uint8Array.from(bytes),
  });
  const eTag = response.headers.get('etag');

  if (!response.ok || !eTag) {
    throw new Error('Presigned upload did not return an ETag');
  }

  return eTag;
}

export async function waitForVideoStatus(
  videos: Repository<Video>,
  videoId: string,
  status: VideoStatus,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Video> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const video = await videos.findOneBy({ id: videoId });
    if (video?.status === status) {
      return video;
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS),
    );
  }

  throw new Error(`Timed out waiting for video status ${status}`);
}
