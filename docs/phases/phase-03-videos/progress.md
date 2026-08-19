# phase-03-videos — Progress

**Status:** completed
**SIs:** 12/12 completed

### SI-03.1 — Provisionar infraestrutura de storage e fila
- **Status:** completed
- **Tests:** 10 passing; `npx tsc --noEmit` passed
- **Observations:** none

### SI-03.2 — Persistir vídeos e outbox de processamento
- **Status:** completed
- **Tests:** 9 passing; `npx tsc --noEmit` passed; migration applied and verified
- **Observations:**
  - Jest emitted pre-existing environment warnings for `--localstorage-file` and the `pg` driver deprecation; neither affected the passing tests.

### SI-03.3 — Integrar storage multipart privado
- **Status:** completed
- **Tests:** 5 passing; `npx tsc --noEmit` passed
- **Observations:** none

### SI-03.4 — Implementar ciclo de vida do upload
- **Status:** completed
- **Tests:** 11 passing; `npx tsc --noEmit` passed; focused ESLint passed
- **Observations:**
  - Jest emitted pre-existing environment warnings for `--localstorage-file` and the `pg` driver deprecation; neither affected the passing tests.

### SI-03.5 — Publicar eventos duráveis de processamento
- **Status:** completed
- **Tests:** 13 passing; `npx tsc --noEmit` passed; focused ESLint passed
- **Observations:**
  - Added the missing BullMQ runtime peer dependency `ioredis`; `npm audit` reported 36 vulnerabilities, whose broad remediation is outside this SI.

### SI-03.6 — Expor início e assinatura de upload
- **Status:** completed
- **Tests:** 8 unit, 3 integration, and 4 E2E scenarios passing; `npx tsc --noEmit` and `git diff --check` passed
- **Observations:**
  - Added the approved typed 5 MiB multipart part-size configuration and MIME allowlist (`video/mp4`, `video/webm`, `video/quicktime`) required to complete the inherited lifecycle contract; unsupported media now returns `415 UNSUPPORTED_VIDEO_MEDIA_TYPE`.

### SI-03.7 — Expor conclusão e cancelamento de upload
- **Status:** completed
- **Tests:** 9 unit, 3 integration, and 4 E2E scenarios passing; `npx tsc --noEmit` and `git diff --check` passed
- **Observations:**
  - Semantic completion-list validation now returns `422 MULTIPART_COMPLETION_INVALID`, while syntactically malformed request bodies remain validation errors.

### SI-03.8 — Executar worker de processamento de mídia
- **Status:** completed
- **Tests:** 5 unit and 1 integration scenario passing; `npx tsc --noEmit`, `git diff --check`, worker image build, and FFmpeg/ffprobe probes passed
- **Observations:**
  - Added related TypeORM metadata (`VideoOutbox` and `User`) to the isolated worker module after its DI compilation test surfaced the missing relations.
  - The first worker-image builds stalled in a recursive ownership change; the Dockerfile now avoids it and the final image builds successfully.

### SI-03.9 — Implementar entrega privada por range e download
- **Status:** completed
- **Tests:** 15 unit and integration scenarios passing; `npx tsc --noEmit` and `git diff --check` passed
- **Observations:**
  - Delivery resolves the owner and READY state before opening storage; a single normalized Range is validated before the storage request and invalid ranges return `416 RANGE_NOT_SATISFIABLE`.
  - Download filenames use safe ASCII fallback plus UTF-8 encoding, without disclosing bucket, object key, credentials, or storage URLs.

### SI-03.10 — Expor streaming e download autenticados
- **Status:** completed
- **Tests:** 4 E2E scenarios and 10 module/OpenAPI scenarios passing; `npx tsc --noEmit` and `git diff --check` passed
- **Observations:**
  - A dedicated delivery controller keeps the established channel-scoped upload routes unchanged while exposing the required root-level video delivery routes.
  - The controller forwards headers, status, and the storage stream directly; all ownership, readiness, Range, and attachment decisions remain in `VideoDeliveryService`.

### SI-03.11 — Fluxo funcional de vídeos (cross-layer)
- **Status:** completed
- **Tests:** 5 real cross-layer E2E scenarios, worker integration, and isolated outbox integration passing; `npx tsc --noEmit` and `git diff --check` passed
- **Observations:**
  - The pipeline E2E uses real HTTP, PostgreSQL, MinIO multipart pre-signed upload, Redis/outbox, worker, FFmpeg/ffprobe, and private media delivery; the worker was restored after the isolated publisher assertion.
  - The >10 GB completion path simulates only the `HeadObject` metadata after a real small direct multipart upload, proving control-plane enforcement without materializing 10 GB.

### SI-03.12 — Consolidar documentação e verificação final
- **Status:** completed
- **Tests:** OpenAPI export (11), unit (41 suites / 203 tests), integration (20 suites / 105 tests), HTTP E2E (6 suites / 64 tests), and pipeline E2E (5 tests) passing; migrations, `npx tsc --noEmit`, lint, build, and `git diff --check` passed
- **Observations:**
  - `AGENTS.md`, backend instructions, and the generated OpenAPI now describe only the implemented private multipart, worker, and delivery architecture.
  - The normal HTTP E2E suite runs with the competing worker stopped where its queue assertions require it; the worker is restored and the real pipeline E2E runs with it active.
