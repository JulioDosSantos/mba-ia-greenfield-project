# NestJS subproject instructions

Load `$nestjs-project-conventions` for every change in this directory. Load `$testing-guide-nestjs-project` when planning, implementing, reviewing, or testing behavior. Also load `$nestjs-best-practices` for NestJS architecture and `$typeorm` for database work.

## Environment and hosts

- Run `npm`, `npx`, Node, TypeScript, lint, build, and tests inside `nestjs-api` with `docker compose exec nestjs-api ...`.
- Host probes use `http://localhost:3000` and PostgreSQL at `localhost:5432`.
- Container-to-container connections use Compose service names: PostgreSQL is `db`; Mailpit is `mailpit`; private S3-compatible storage is `minio`; and BullMQ uses `redis`.
- Starting the environment means `docker compose up -d`; do not start the persistent NestJS dev server unless the user asks to run the app.
- `video-worker` is a separate no-port Compose service. It starts `VideoWorkerModule` with `npm run start:worker`, consumes Redis/BullMQ video jobs, and requires FFmpeg and ffprobe in its image.
- After startup, verify `docker compose ps` and `docker compose exec db pg_isready -U streamtube`; keep `video-worker` running for media-pipeline E2Es.

## Architecture and tests

- Keep controllers focused on HTTP, services on business rules, and each domain in its own module.
- `VideosModule` owns authenticated multipart upload endpoints under `/channels/:channelId/videos` and private stream/download endpoints under `/videos/:publicId`. Keep upload/storage rules in `VideosService` and delivery rules in `VideoDeliveryService`; controllers must not expose storage bucket, key, multipart ID, credentials, or permanent storage URLs.
- Videos use the lifecycle `DRAFT` -> `PROCESSING` -> `READY` or `ERROR`. A completed upload writes a video outbox event, the API publisher retries pending events at bootstrap and periodically before queueing them in Redis/BullMQ, and `video-worker` uses private MinIO objects plus FFmpeg/ffprobe to persist safe media metadata and a private thumbnail.
- The 10 GB limit is inclusive and is checked both before upload and after multipart completion. An oversized completed object is deleted from private storage together with its draft, and no processing event is emitted; if compensation fails, the draft remains recoverable.
- `*.spec.ts` is unit, `*.integration-spec.ts` uses real infrastructure and runs serially, and `test/*.e2e-spec.ts` exercises HTTP with Supertest.
- Shared-database integration and e2e runs must use `--runInBand` where the script does not already enforce it.
- The video outbox publisher integration assertion needs a queue without a competing Compose consumer. Stop only `video-worker` for that isolated test, then start it again and confirm it is healthy before running pipeline E2Es.
- Runtime assets such as Handlebars templates must be declared in `nest-cli.json`.

## Completion gates

Run the relevant tests, then as applicable:

```text
docker compose exec nestjs-api npm run migration:run
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:integration
docker compose exec nestjs-api npm run test:e2e -- --runInBand
docker compose exec nestjs-api npx tsc --noEmit
docker compose exec nestjs-api npm run lint
docker compose exec nestjs-api npm run build
```

`npm run lint` fixes files. Review the diff afterward and reject unrelated automatic changes.
