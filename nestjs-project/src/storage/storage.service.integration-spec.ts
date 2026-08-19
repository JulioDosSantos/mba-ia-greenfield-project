import {
  DeleteObjectCommand,
  type S3ClientConfig,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const PART_SIZE_BYTES = 5 * 1024 * 1024;
const STORAGE_BUCKET = 'streamtube-media';

function createS3Config(): S3ClientConfig {
  return {
    endpoint: 'http://minio:9000',
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
    },
    forcePathStyle: true,
  };
}

async function uploadPart(url: string, body: Buffer): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: Uint8Array.from(body),
  });
  const etag = response.headers.get('etag');

  expect(response.ok).toBe(true);
  expect(etag).not.toBeNull();

  return etag!;
}

describe('StorageService (integration)', () => {
  let module: TestingModule;
  let storageService: StorageService;
  let cleanupClient: S3Client;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    await module.init();

    storageService = module.get(StorageService);
    cleanupClient = new S3Client(createS3Config());
  });

  afterAll(async () => {
    await Promise.all(
      createdKeys.map((Key) =>
        cleanupClient.send(
          new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key }),
        ),
      ),
    );
    cleanupClient.destroy();
    await module.close();
  });

  it('should create a multipart session, sign and complete parts, then head the private object', async () => {
    const storageKey = `videos/test-channel/${randomUUID()}/source`;
    createdKeys.push(storageKey);
    const firstPart = Buffer.alloc(PART_SIZE_BYTES, 1);
    const secondPart = Buffer.from('final multipart part');

    const { uploadId } = await storageService.createMultipartUpload(
      storageKey,
      'video/mp4',
    );
    const signedParts = await storageService.signUploadParts(
      storageKey,
      uploadId,
      [1, 2],
    );

    expect(uploadId).toEqual(expect.any(String));
    expect(signedParts).toHaveLength(2);
    expect(signedParts.every((part) => part.url.includes('X-Amz-'))).toBe(true);

    const firstEtag = await uploadPart(signedParts[0].url, firstPart);
    const secondEtag = await uploadPart(signedParts[1].url, secondPart);

    await storageService.completeMultipartUpload(storageKey, uploadId, [
      { partNumber: 2, etag: secondEtag },
      { partNumber: 1, etag: firstEtag },
    ]);

    const metadata = await storageService.headObject(storageKey);
    expect(metadata.ContentLength).toBe(firstPart.length + secondPart.length);
    expect(metadata.ContentType).toBe('video/mp4');
  }, 30000);

  it('should abort another multipart session', async () => {
    const storageKey = `videos/test-channel/${randomUUID()}/source`;
    const { uploadId } = await storageService.createMultipartUpload(
      storageKey,
      'video/mp4',
    );

    await expect(
      storageService.abortMultipartUpload(storageKey, uploadId),
    ).resolves.toBeUndefined();
  });

  it('should delete a private object idempotently', async () => {
    const storageKey = `videos/test-channel/${randomUUID()}/source`;
    createdKeys.push(storageKey);
    await storageService.putObject(
      storageKey,
      Buffer.from('delete me'),
      'video/mp4',
    );

    await expect(
      storageService.deleteObject(storageKey),
    ).resolves.toBeUndefined();
    await expect(
      storageService.deleteObject(storageKey),
    ).resolves.toBeUndefined();
    await expect(storageService.headObject(storageKey)).rejects.toBeDefined();
  });
});
