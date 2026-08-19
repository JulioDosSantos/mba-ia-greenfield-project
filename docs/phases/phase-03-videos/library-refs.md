---
libs:
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-08-19T03:46:27.9650419Z"
  "bullmq":
    version: "^6.1.2"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-08-19T03:46:27.9650419Z"
  "@aws-sdk/client-s3":
    version: "^3.1113.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-08-19T03:46:27.9650419Z"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1113.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-08-19T03:46:27.9650419Z"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-19T14:04:22.4148700Z"
---

# Library References — Phase 03 Videos

## Compatibility basis

The backend manifest accepts NestJS `^11.0.1` and TypeORM `^0.3.28`; the audited lockfile resolves them to NestJS `11.2.1` and TypeORM `0.3.31`, and the development container uses Node `25.6.0`. The npm registry reports that `@nestjs/bullmq@11.0.5` supports NestJS 11 and BullMQ 6, while both selected AWS SDK packages require Node 20 or later. Context7 was consulted for the selected versions and the API surfaces below.

### @nestjs/bullmq

**Version:** `^11.0.5`
**Context7:** `/nestjs/bull`

- Configure the named BullMQ queue through Nest's module integration and implement consumers with `@Processor`, `WorkerHost`, and `process(job)`.
- Keep processors inside the separate `video-worker` application process so CPU-bound FFmpeg work never runs in the HTTP API container.
- Use worker lifecycle hooks only for queue-observation concerns; video state transitions remain guarded by the persisted video record.

### bullmq

**Version:** `^6.1.2`
**Context7:** `/taskforcesh/bullmq`

- Publish `video.process` with the deterministic `jobId = videoId`, `attempts: 3`, and exponential `backoff` selected in TD-01 and TD-09.
- BullMQ ignores an added job whose `jobId` already exists, so queue-level duplication is harmless; the worker must still make database transitions idempotent for at-least-once delivery.
- Use the queue payload `{ version: 1, videoId }`; reload storage keys and current status from PostgreSQL rather than treating the job payload as a snapshot.

### @aws-sdk/client-s3

**Version:** `^3.1113.0`
**Context7:** `/aws/aws-sdk-js-v3`

- Use `CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, and `AbortMultipartUploadCommand` for the persisted multipart lifecycle; completion uses the ordered `PartNumber`/`ETag` list.
- Confirm the object after completion with `HeadObjectCommand`, enforce the 10 GB (`10_000_000_000` bytes) limit, and persist the durable outbox before the worker claims the later `DRAFT` → `PROCESSING` transition.
- Use `GetObjectCommand` with the incoming HTTP `Range` for the owner-authorized proxy; forward its stream and response metadata without buffering the full file in API memory.

### @aws-sdk/s3-request-presigner

**Version:** `^3.1113.0`
**Context7:** `/aws/aws-sdk-js-v3`

- Generate short-lived per-part upload URLs from `UploadPartCommand` with `getSignedUrl`; the API issues URLs as control-plane responses while clients transfer bytes directly to MinIO/S3.
- Do not expose permanent S3 credentials or the internal storage key in API responses.

## Sources consulted

- Nest BullMQ integration: Context7 `/nestjs/bull` (processor, `WorkerHost`, worker options).
- BullMQ: Context7 `/taskforcesh/bullmq` (`Queue.add`, `jobId`, retries, exponential backoff, duplicate behavior).
- AWS SDK for JavaScript v3: Context7 `/aws/aws-sdk-js-v3` (multipart lifecycle, presigned URL generation, and S3 streams).
