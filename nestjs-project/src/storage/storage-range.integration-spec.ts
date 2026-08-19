import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const STORAGE_BUCKET = 'streamtube-media';

function createCleanupClient(): S3Client {
  return new S3Client({
    endpoint: 'http://minio:9000',
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
    },
    forcePathStyle: true,
  });
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

describe('StorageService range access (integration)', () => {
  let module: TestingModule;
  let storageService: StorageService;
  let cleanupClient: S3Client;
  let storageKey: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    await module.init();

    storageService = module.get(StorageService);
    cleanupClient = createCleanupClient();
    storageKey = `videos/test-channel/${randomUUID()}/source`;

    const source = Buffer.from('abcdefghij');
    const { uploadId } = await storageService.createMultipartUpload(
      storageKey,
      'video/mp4',
    );
    const [part] = await storageService.signUploadParts(storageKey, uploadId, [1]);
    const response = await fetch(part.url, {
      method: 'PUT',
      body: Uint8Array.from(source),
    });
    const etag = response.headers.get('etag');

    expect(response.ok).toBe(true);
    expect(etag).not.toBeNull();

    await storageService.completeMultipartUpload(storageKey, uploadId, [
      { partNumber: 1, etag: etag! },
    ]);
  }, 30000);

  afterAll(async () => {
    await cleanupClient.send(
      new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: storageKey }),
    );
    cleanupClient.destroy();
    await module.close();
  });

  it('should return a Node stream and only the requested byte range with S3 metadata', async () => {
    const object = await storageService.getObject(storageKey, 'bytes=2-5');

    expect(object.Body).toBeInstanceOf(Readable);
    await expect(readStream(object.Body)).resolves.toEqual(Buffer.from('cdef'));
    expect(object.ContentLength).toBe(4);
    expect(object.ContentRange).toBe('bytes 2-5/10');
    expect(object.ContentType).toBe('video/mp4');
  });
});
