import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';

export type MultipartUploadPart = {
  partNumber: number;
  etag: string;
};

export type PresignedUploadPart = {
  partNumber: number;
  url: string;
};

export type StorageObjectMetadata = {
  ContentLength: number | undefined;
  ContentType: string | undefined;
};

export type StorageObjectStream = StorageObjectMetadata & {
  Body: Readable;
  ContentRange: string | undefined;
};

@Injectable()
export class StorageService implements OnModuleInit {
  private bucketInitialization: Promise<void> | undefined;

  constructor(
    @Inject(S3Client) private readonly s3Client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  async createMultipartUpload(
    storageKey: string,
    contentType: string,
  ): Promise<{ uploadId: string }> {
    await this.ensureBucket();

    const result = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.storage.bucket,
        Key: storageKey,
        ContentType: contentType,
      }),
    );

    if (!result.UploadId) {
      throw new Error('Storage did not return a multipart upload ID');
    }

    return { uploadId: result.UploadId };
  }

  async signUploadParts(
    storageKey: string,
    uploadId: string,
    partNumbers: readonly number[],
  ): Promise<PresignedUploadPart[]> {
    await this.ensureBucket();

    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.s3Client,
          new UploadPartCommand({
            Bucket: this.storage.bucket,
            Key: storageKey,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: this.storage.multipartUrlExpirationSeconds },
        ),
      })),
    );
  }

  async completeMultipartUpload(
    storageKey: string,
    uploadId: string,
    parts: readonly MultipartUploadPart[],
  ): Promise<void> {
    await this.ensureBucket();

    const orderedParts = [...parts].sort(
      (left, right) => left.partNumber - right.partNumber,
    );

    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.storage.bucket,
        Key: storageKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: orderedParts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );
  }

  async abortMultipartUpload(
    storageKey: string,
    uploadId: string,
  ): Promise<void> {
    await this.ensureBucket();

    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.storage.bucket,
        Key: storageKey,
        UploadId: uploadId,
      }),
    );
  }

  async headObject(storageKey: string): Promise<StorageObjectMetadata> {
    await this.ensureBucket();

    const result = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.storage.bucket,
        Key: storageKey,
      }),
    );

    return {
      ContentLength: result.ContentLength,
      ContentType: result.ContentType,
    };
  }

  async getObject(
    storageKey: string,
    range?: string,
  ): Promise<StorageObjectStream> {
    await this.ensureBucket();

    const result = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.storage.bucket,
        Key: storageKey,
        ...(range ? { Range: range } : {}),
      }),
    );

    if (!result.Body || !this.isNodeReadable(result.Body)) {
      throw new Error('Storage did not return a Node.js readable stream');
    }

    return {
      Body: result.Body,
      ContentLength: result.ContentLength,
      ContentRange: result.ContentRange,
      ContentType: result.ContentType,
    };
  }

  private async ensureBucket(): Promise<void> {
    this.bucketInitialization ??= this.createBucketIfNeeded();
    await this.bucketInitialization;
  }

  private async createBucketIfNeeded(): Promise<void> {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.storage.bucket }),
      );
      return;
    } catch (error) {
      if (!this.hasHttpStatus(error, 404)) {
        throw error;
      }
    }

    try {
      await this.s3Client.send(
        new CreateBucketCommand({ Bucket: this.storage.bucket }),
      );
    } catch (error) {
      if (!this.isBucketAlreadyOwned(error)) {
        throw error;
      }
    }
  }

  private hasHttpStatus(error: unknown, expectedStatus: number): boolean {
    if (typeof error !== 'object' || error === null || !('$metadata' in error)) {
      return false;
    }

    const metadata = error.$metadata;
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      'httpStatusCode' in metadata &&
      metadata.httpStatusCode === expectedStatus
    );
  }

  private isBucketAlreadyOwned(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'BucketAlreadyOwnedByYou'
    );
  }

  private isNodeReadable(body: unknown): body is Readable {
    return (
      typeof body === 'object' &&
      body !== null &&
      'pipe' in body &&
      typeof body.pipe === 'function'
    );
  }
}
