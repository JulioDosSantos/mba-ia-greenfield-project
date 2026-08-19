---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-08-16T22:22:22.9389174Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-19T03:50:05.0286683Z"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-08-18T02:12:15.6601140Z"
  docs/phases/phase-01-configuracao-base/context.md: "2026-08-18T02:12:15.6723949Z"
  docs/phases/phase-02-auth/context.md: "2026-08-18T02:12:15.7018888Z"
  docs/phases/phase-02-auth-frontend/context.md: "2026-08-18T02:12:15.6775640Z"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-08-18T04:02:58.9223570Z"
  docs/phases/phase-03-videos/library-refs.md: "2026-08-19T03:50:26.7438095Z"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** `next-frontend/` e qualquer nova superfície de UI/BFF; publicação, categorias e edição completa de vídeos pertencem à Fase 04.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`.

**Deferred subprojects:** `next-frontend/` — explicitamente fora do escopo desta fase.

**Sequencing notes:** depende das Fases 01 e 02; preserva seus contratos de configuração, autenticação, canal e tratamento de erros.

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta.
- **Phase 04:** Gerenciamento de Vídeos e Canal.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue, isolated worker, and retry delivery policy | decided | A | — |
| phase-03-videos/TD-02 | phase | Backend | Direct multipart upload protocol for files up to 10 GB | decided | A | — |
| phase-03-videos/TD-03 | phase | Backend | Private MinIO/S3 layout and abandoned-upload cleanup | decided | A | — |
| phase-03-videos/TD-04 | phase | Backend | Video state machine, terminal failure, and idempotency | decided | A | — |
| phase-03-videos/TD-05 | phase | Backend | Opaque public URL and authenticated range/download delivery | decided | A | — |
| phase-03-videos/TD-06 | phase | Backend | Channel ownership and private-media authorization | decided | A | — |
| phase-03-videos/TD-07 | phase | Backend | Resumable multipart upload lifecycle contract | decided | A | — |
| phase-03-videos/TD-08 | phase | Backend | FFmpeg and ffprobe worker-processing contract | decided | A | — |
| phase-03-videos/TD-09 | phase | Backend | Durable video-processing event contract | decided | A | — |
| phase-03-videos/TD-10 | phase | Backend | Video infrastructure library versions | decided | A | `@nestjs/bullmq@^11.0.5`, `bullmq@^6.1.2`, `@aws-sdk/client-s3@^3.1113.0`, `@aws-sdk/s3-request-presigner@^3.1113.0` |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02, phase-03-videos/TD-03, phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-10 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-09, phase-03-videos/TD-10 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-07, phase-03-videos/TD-10 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-06, phase-03-videos/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-01, phase-03-videos/TD-04, phase-03-videos/TD-08, phase-03-videos/TD-09 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-01, phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-08, phase-03-videos/TD-09 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-05 |
| Download do vídeo pelo usuário | phase-03-videos/TD-05 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ + Redis separa a carga de processamento, entrega os mecanismos de retry e deduplicação exigidos sem criar uma topologia de mensageria desproporcional.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** multipart pré-assinado preserva a API como plano de controle, deixa o plano de dados no storage e atende o limite sem introduzir um segundo serviço de upload.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** um bucket privado com prefixos opacos oferece a separação necessária e a menor superfície operacional para a primeira fase de mídia.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** quatro estados de negócio, transições condicionais e `jobId = videoId` conciliam simplicidade, recuperação e entrega ao menos uma vez.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** um identificador opaco com proxy de byte range atende streaming e download agora, preservando a separação entre a URL do produto, o storage privado e a futura publicação.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** a relação de propriedade já existe e mantém upload e mídia privados até que a Fase 04 decida visibilidade e colaboração.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** a sessão persistida no `DRAFT` sustenta retomada, expiração e conclusão idempotente sem transportar o arquivo pela API.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** o worker com binários explícitos preserva o isolamento já escolhido, oferece diagnósticos diretos e não cria dependência adicional de runtime.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** o outbox torna a fronteira PostgreSQL–Redis recuperável e o payload mínimo mantém o banco como fonte de verdade.
**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** é a combinação oficialmente documentada, compatível com o runtime instalado e suficiente para o protocolo decidido sem wrappers de mídia.
**Libraries:** `@nestjs/bullmq@^11.0.5`, `bullmq@^6.1.2`, `@aws-sdk/client-s3@^3.1113.0`, `@aws-sdk/s3-request-presigner@^3.1113.0`

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (`@nestjs/config`) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with `registerAs`) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared `registerAs` factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (`@nestjs/passport`) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (`@nestjs-modules/mailer`) — Best NestJS integration with minimal boilerplate. Supports SMTP, works with MailHog/Mailpit locally, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (`class-validator` + `class-transformer`) — This is a backend-only project, so Zod's single-source-of-truth advantage is less impactful. `class-validator` is the documented NestJS approach, and the project already uses decorators extensively. Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. A simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (`@nestjs/throttler`) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Use a small custom cookie-session helper: the strict-BFF model makes Route Handlers the only NestJS caller, it has a smaller/debuggable blast radius than Auth.js, and built-in `next/headers` `cookies()` is canonical for Next.js 16 / React 19. Reject `localStorage` refresh tokens.
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Use encrypted `httpOnly` single-cookie sessions with minimal user metadata (`userId`, `email`, `channelSlug`), allowing authenticated RSC chrome without a `/auth/me` round-trip. `iron-session` is a viable dependency for this.
**Libraries:** `iron-session`

### phase-02-auth-frontend/TD-03

**Recommendation:** Implement token refresh single-flight in the helper from day one, tested through two concurrent intercepted upstream calls with one expected refresh. Reject client-driven refresh because RSC still requires server-side refresh.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Use `react-hook-form` with the shadcn canonical form primitive and Zod-first schemas. It works independently of the mutation transport and avoids hand-rolled form machinery.
**Libraries:** `react-hook-form`, `@hookform/resolvers`

### phase-02-auth-frontend/TD-05

**Recommendation:** Use Route Handlers as the sole mutation surface under `app/api/**`, consistent with the strict BFF and the existing Route-Handler-as-function MSW test scaffold.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Deliver the session with the page HTML, let RSC read the cookie, and hydrate the Client Provider from that initial state. After session-changing mutations, call `router.refresh()`.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Use a first-paint-correct RSC-owned email-token flow: RSC processes the token server-side, while a Client Component owns reset input. Confirmation is RSC-only.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** **Option A (`@nestjs/swagger`)** — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** **Option C (Ambos)** — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** **Option B (Apenas em dev/staging)** — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | UI landing screen de-scoped; FE confirmation flow is deferred to a future phase. |
| "Logout" | deferred | phase-02-auth-frontend | UI belongs in authenticated chrome; the BFF `POST /api/auth/logout` contract is ready. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | The reset destination is absent from Figma; `/forgot-password` sends email but the link remains a 404 until a later screen-inventory extension. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | The umbrella capability remains deferred until confirmation and reset-password destination screens land. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration with a real database for constraints and defaults |
| Service with branching or DB access | Unit for business branches plus integration for repository/query contracts |
| Service with storage or queue side effects | Integration against the local real service boundary; unit tests mock only across module boundaries |
| Module with configured imports | Unit DI compilation test |
| Controller | E2E only, covering HTTP contract and authorization |
| DTO | E2E validation-wiring test per endpoint |
| Guard or ownership rule | E2E, plus unit testing when it has non-trivial internal logic |

The implementation must also retain the backend quality gates: unit and integration tests, HTTP E2E tests, `npx tsc --noEmit`, lint, and build.
