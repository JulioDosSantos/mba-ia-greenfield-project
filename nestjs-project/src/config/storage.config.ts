import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION,
  accessKeyId: process.env.STORAGE_ACCESS_KEY,
  secretAccessKey: process.env.STORAGE_SECRET_KEY,
  bucket: process.env.STORAGE_BUCKET,
  multipartUrlExpirationSeconds: parseInt(
    process.env.STORAGE_MULTIPART_URL_EXPIRATION_SECONDS ?? '900',
    10,
  ),
}));
