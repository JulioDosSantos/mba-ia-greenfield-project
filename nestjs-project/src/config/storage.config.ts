import { registerAs } from '@nestjs/config';

export const DEFAULT_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 5_242_880;

function parseVideoMimeTypes(value: string): string[] {
  return value
    .split(',')
    .map((mimeType) => mimeType.trim())
    .filter((mimeType) => mimeType.length > 0);
}

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION,
  accessKeyId: process.env.STORAGE_ACCESS_KEY,
  secretAccessKey: process.env.STORAGE_SECRET_KEY,
  bucket: process.env.STORAGE_BUCKET,
  allowedVideoMimeTypes: parseVideoMimeTypes(
    process.env.STORAGE_ALLOWED_VIDEO_MIME_TYPES ??
      DEFAULT_VIDEO_MIME_TYPES.join(','),
  ),
  multipartUrlExpirationSeconds: parseInt(
    process.env.STORAGE_MULTIPART_URL_EXPIRATION_SECONDS ?? '900',
    10,
  ),
  multipartPartSizeBytes: parseInt(
    process.env.STORAGE_MULTIPART_PART_SIZE_BYTES ??
      String(DEFAULT_MULTIPART_PART_SIZE_BYTES),
    10,
  ),
}));
