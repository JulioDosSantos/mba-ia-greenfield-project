---
kind: phase
name: phase-03-videos
test_specs_aware: true
affected_subprojects: [nestjs-project]
sources_mtime:
  docs/project-plan.md: "2026-08-16T22:22:22.9389174Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-19T03:50:05.0286683Z"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-08-18T02:12:15.6601140Z"
  docs/phases/phase-01-configuracao-base/context.md: "2026-08-18T02:12:15.6723949Z"
  docs/phases/phase-02-auth/context.md: "2026-08-18T02:12:15.7018888Z"
  docs/phases/phase-02-auth-frontend/context.md: "2026-08-18T02:12:15.6775640Z"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-08-18T04:02:58.9223570Z"
  docs/phases/phase-03-videos/library-refs.md: "2026-08-19T03:50:26.7438095Z"
  docs/phases/phase-03-videos/context.md: "2026-08-19T03:50:38.8254040Z"
---

# Fase 03 — Upload e Processamento de Vídeos

## Objective

Entregar storage privado para vídeos e thumbnails, fila e worker de processamento, upload multipart direto de arquivos de até 10 GB com pré-cadastro em rascunho, processamento automático com metadados e thumbnail, URL pública opaca e entrega autenticada por streaming e download.

---

## Step Implementations

### SI-03.1 — Provisionar infraestrutura de storage e fila

**Description:** Adiciona as dependências, a configuração tipada e os serviços locais de MinIO e Redis que sustentam o módulo sem introduzir credenciais ou hosts fora do Compose.

**Technical actions:**

1. Atualizar `nestjs-project/package.json` e o lockfile com `@nestjs/bullmq@^11.0.5`, `bullmq@^6.1.2`, `@aws-sdk/client-s3@^3.1113.0` e `@aws-sdk/s3-request-presigner@^3.1113.0` (per `phase-03-videos/TD-10`).
2. Criar `src/config/storage.config.ts` e `src/config/queue.config.ts`; carregá-los em `AppModule` e validar suas variáveis em `src/config/env.validation.ts` com `registerAs()` e `ConfigType` (per `phase-01-configuracao-base/TD-01` and `phase-01-configuracao-base/TD-03`).
3. Atualizar `nestjs-project/.env.example` com valores locais não secretos para endpoint, bucket, região, expiração multipart e conexão Redis; manter segredos reais fora do Git.
4. Estender `nestjs-project/compose.yaml` com MinIO privado e Redis, volumes persistentes, healthchecks e dependências da API usando somente nomes de serviço do Compose (per `phase-03-videos/TD-01` and `phase-03-videos/TD-03`).
5. Ajustar a configuração de inicialização da API para importar os novos factories sem duplicar parâmetros de ambiente (per `phase-01-configuracao-base/TD-04`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Storage and queue environment validation | Integration: accepts complete local configuration and rejects invalid required values | `nestjs-project/src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose config --services` lista `minio` e `redis` junto de `nestjs-api`, `db` e `mailpit`.
- MinIO e Redis permanecem healthy/running com volumes após `docker compose up -d`.
- Inicializar a API com configuração válida de storage e fila não usa `localhost` para conexões entre containers.
- Uma configuração sem endpoint, bucket ou conexão Redis válidos é rejeitada na validação de ambiente.

---

### SI-03.2 — Persistir vídeos e outbox de processamento

**Description:** Cria o modelo relacional versionado para rascunhos, estados, metadados e publicação durável de trabalho, ligado bidirecionalmente ao canal existente.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` e `src/videos/video-status.enum.ts` com todos os campos, enum, índices e restrições de `### Data Model → Video` (per `phase-03-videos/TD-04` and `phase-03-videos/TD-05`).
2. Criar `src/videos/entities/video-outbox.entity.ts` com payload versionado e a unicidade `(video_id, event_type)` definida em `### Data Model → VideoOutbox` (per `phase-03-videos/TD-09`).
3. Atualizar `src/channels/entities/channel.entity.ts` com o lado inverso `videos` e criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video, VideoOutbox])` (per `phase-03-videos/TD-06`).
4. Gerar e revisar `src/database/migrations/<timestamp>-CreateVideosAndVideoOutbox.ts`, com `up()` e `down()` reversíveis para tabelas, FKs, enum e índices.
5. Atualizar `src/test/create-test-data-source.ts`, `cleanAllTables()` e a suíte de migrations para registrar e limpar as novas entidades sem `synchronize` em testes de migration.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: defaults, unicidade de `public_id`, limites e FK para `Channel` | `nestjs-project/src/videos/entities/video.entity.integration-spec.ts` |
| `VideoOutbox` | Integration: payload, FK e unicidade de evento por vídeo | `nestjs-project/src/videos/entities/video-outbox.entity.integration-spec.ts` |
| `VideosModule` | Unit: compilação DI com `TypeOrmModule.forFeature` | `nestjs-project/src/videos/videos.module.spec.ts` |
| Videos migration | Integration: aplica e reverte o esquema com entidades explícitas | `nestjs-project/src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.1 — configuração e serviços locais disponíveis

**Acceptance criteria:**

- Aplicar a migration cria `videos` e `video_outbox` com FKs para `channels` e índices previstos.
- Criar dois vídeos com o mesmo `public_id` falha pela restrição única.
- Um vídeo persistido inicia em `DRAFT`, tem `title`, pertence a um canal e não aceita `size_bytes` acima de `10_000_000_000`.
- Uma segunda outbox `video.process` para o mesmo vídeo viola a unicidade em vez de duplicar a publicação.

---

### SI-03.3 — Integrar storage multipart privado

**Description:** Encapsula MinIO/S3 como fronteira de infraestrutura para criar sessões multipart, assinar partes, confirmar objetos e abrir streams sem expor chaves ou credenciais.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` e `src/storage/storage.service.ts` com `S3Client` injetado por `storage.config`, bucket privado e inicialização idempotente do bucket (per `phase-03-videos/TD-03` and `phase-03-videos/TD-10`).
2. Criar `src/storage/storage-key.factory.ts` para gerar chaves opacas de vídeo e thumbnail sem derivá-las de `title` ou `original_filename` (per `phase-03-videos/TD-03`).
3. Implementar a fronteira multipart `create`, `signUploadParts`, `complete` e `abort` usando os comandos S3 selecionados; manter `multipart_upload_id` apenas no banco (per `phase-03-videos/TD-02`, `phase-03-videos/TD-07`, and `phase-03-videos/TD-10`).
4. Implementar `headObject` e `getObject` com suporte a `Range`, devolvendo stream e metadados para a camada de entrega sem materializar o arquivo na memória da API (per `phase-03-videos/TD-05` and `phase-03-videos/TD-10`).
5. Exportar somente a interface de storage necessária para `VideosModule` e o worker, preservando configuração e credenciais dentro de `StorageModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` multipart lifecycle | Integration: MinIO real cria, assina, completa, faz head e aborta upload | `nestjs-project/src/storage/storage.service.integration-spec.ts` |
| `StorageService` range read | Integration: MinIO real retorna stream e metadados de uma faixa de bytes | `nestjs-project/src/storage/storage-range.integration-spec.ts` |
| `storage-key.factory` | Unit: gera chaves opacas distintas sem nome de arquivo | `nestjs-project/src/storage/storage-key.factory.spec.ts` |

**Dependencies:** SI-03.1 — configuração, MinIO e SDK disponíveis

**Acceptance criteria:**

- Uma criação multipart gera uma sessão no bucket privado e não retorna chave interna ou credencial à chamada de controle.
- Solicitar partes válidas produz URLs de curta duração para os números solicitados.
- Completar a lista ordenada de partes permite `HeadObject` com tamanho e MIME esperados; abortar remove a sessão multipart.
- Ler uma faixa devolve somente os bytes e metadados solicitados, sem a API armazenar o objeto inteiro em memória.

---

### SI-03.4 — Implementar ciclo de vida do upload

**Description:** Implementa as regras de negócio de rascunho, propriedade, sessão multipart, conclusão idempotente e cancelamento antes do processamento.

**Technical actions:**

1. Criar `src/videos/repositories/videos.repository.ts` e `src/videos/repositories/video-outbox.repository.ts` para consultas owner-scoped, transições condicionais de estado e recuperação de outbox (per `phase-03-videos/TD-04` and `phase-03-videos/TD-06`).
2. Criar `src/videos/videos.service.ts` para pré-cadastrar `DRAFT` com `title`, storage key opaca e sessão multipart, em transação com a persistência necessária (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`, and `phase-03-videos/TD-07`).
3. Implementar emissão de URLs por partes, exigindo proprietário, sessão não expirada e `part_numbers` válidos antes de chamar `StorageService` (per `phase-03-videos/TD-06` and `phase-03-videos/TD-07`).
4. Implementar conclusão que faz complete + `HeadObject`, repete o limite real de `10_000_000_000`, registra uma única outbox e preserva o `DRAFT` para a transição do worker (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`, and `phase-03-videos/TD-09`).
5. Implementar cancelamento e limpeza de sessões `DRAFT` expiradas com abort idempotente, remoção do rascunho e exceções do `### Error Catalog` (per `phase-03-videos/TD-03` and `phase-03-videos/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: ownership, expiração, limite, transições e conclusão duplicada | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService` upload lifecycle | Integration: PostgreSQL + MinIO reais persistem rascunho, multipart, head, outbox e cancelamento | `nestjs-project/src/videos/videos.service.integration-spec.ts` |
| Video repositories | Integration: consultas owner-scoped e updates condicionais não retrocedem estado | `nestjs-project/src/videos/repositories/videos.repository.integration-spec.ts` |

**Dependencies:** SI-03.2 — entidades e migration; SI-03.3 — fronteira multipart privada

**Acceptance criteria:**

- Iniciar um upload cria um único vídeo `DRAFT` com `title`, `channel_id`, `public_id` único e sessão multipart persistida.
- Um usuário não proprietário não recebe URLs de partes nem conclui ou cancela um vídeo de outro canal.
- Conclusão válida verifica o tamanho real e deixa exatamente uma outbox `video.process` para o vídeo.
- Concluir novamente não cria uma segunda outbox nem regride o estado do vídeo.
- Uma sessão expirada é abortada no storage e não pode receber novas URLs nem ser concluída.

---

### SI-03.5 — Publicar eventos duráveis de processamento

**Description:** Conecta a outbox transacional à fila BullMQ para entregar somente `{ version: 1, videoId }`, com recuperação de publicação e deduplicação determinística.

**Technical actions:**

1. Criar `src/queue/queue.module.ts` e registrar a conexão Redis e a fila nomeada de vídeos com `@nestjs/bullmq` e a configuração tipada (per `phase-03-videos/TD-01` and `phase-03-videos/TD-10`).
2. Criar `src/videos/video-outbox.publisher.ts` para buscar registros não publicados, enviar `video.process` com `jobId = videoId`, `attempts: 3` e backoff exponencial (per `phase-03-videos/TD-01`, `phase-03-videos/TD-09`, and `phase-03-videos/TD-10`).
3. Marcar `published_at` somente depois da aceitação pela fila e preservar o registro para nova tentativa quando Redis estiver indisponível (per `phase-03-videos/TD-09`).
4. Executar a recuperação de outbox pendente no bootstrap e após uma conclusão idempotente, sem enviar snapshot de chaves de storage no payload (per `phase-03-videos/TD-04` and `phase-03-videos/TD-09`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `QueueModule` | Unit: compilação DI com configuração Redis | `nestjs-project/src/queue/queue.module.spec.ts` |
| `VideoOutboxPublisher` | Unit: job ID, tentativas, backoff e marcação somente após sucesso | `nestjs-project/src/videos/video-outbox.publisher.spec.ts` |
| Outbox-to-Redis delivery | Integration: Redis real recebe uma única mensagem versionada e recupera pendências | `nestjs-project/src/videos/video-outbox.publisher.integration-spec.ts` |

**Dependencies:** SI-03.1 — Redis e bibliotecas; SI-03.2 — outbox; SI-03.4 — conclusão cria a outbox

**Acceptance criteria:**

- Uma outbox pendente publica `video.process` com payload exatamente `{ version: 1, videoId }` e `jobId` igual ao vídeo.
- Repetir a publicação do mesmo vídeo não cria um segundo job lógico na fila.
- Se Redis falhar, `published_at` permanece vazio e o registro é recuperável no próximo bootstrap/publicação.
- Após a fila aceitar o job, a outbox registra `published_at` sem vazar chaves de storage no payload.

---

### SI-03.6 — Expor início e assinatura de upload

**Route:** POST /channels/:channelId/videos/uploads; POST /channels/:channelId/videos/:videoId/upload-parts
**Test Specs:** see `nestjs-project/specs/video-upload-initiation.plan.md`
**Authorization:** proprietário do canal em ambas as rotas

**Description:** Expõe o primeiro trecho do plano de controle multipart com DTOs validados, Swagger completo e delegação fina ao ciclo de vida de vídeos.

**Technical actions:**

1. Criar `src/videos/dto/create-video-upload.dto.ts`, `src/videos/dto/request-upload-parts.dto.ts` e DTOs de parâmetros UUID que reproduzem `### API Contracts` e `#### Validation Rules` verbatim.
2. Criar `src/videos/videos.controller.ts` com `POST /channels/:channelId/videos/uploads`, `CurrentUser`, status `201` e o contrato de rascunho `{ id, public_id, status, part_size_bytes, upload_expires_at }`.
3. Adicionar `POST /channels/:channelId/videos/:videoId/upload-parts` com status `200`, resposta `{ parts: [{ part_number, url, expires_at }] }` e nenhuma chave interna de storage.
4. Documentar ambas as operações e todos os erros previsíveis no Swagger com `ApiErrorEnvelope`, `@ApiBearerAuth('access-token')` e sem `try/catch` no controller (per `openapi-docs-nestjs/TD-01` and `phase-02-auth/TD-07`).

**Tests:** _(empty — controller contract scenarios are owned by the pending Test Specs)_

**Dependencies:** SI-03.4 — regras de rascunho e partes; SI-03.5 — infraestrutura que receberá a outbox posterior

**Acceptance criteria:**

- `POST /channels/:channelId/videos/uploads` com `title`, filename, MIME e tamanho válidos retorna `201` com um rascunho sem chave de storage.
- O mesmo POST com tamanho acima de `10_000_000_000` retorna `413` com `VIDEO_SIZE_LIMIT_EXCEEDED`.
- `POST /channels/:channelId/videos/:videoId/upload-parts` com partes distintas retorna `200` com URLs de curta duração.
- Um token de outro canal recebe `403 CHANNEL_ACCESS_DENIED` nas duas rotas e não obtém URL de upload.

---

### SI-03.7 — Expor conclusão e cancelamento de upload

**Route:** POST /channels/:channelId/videos/:videoId/complete-upload; DELETE /channels/:channelId/videos/:videoId/upload
**Test Specs:** see `nestjs-project/specs/video-upload-completion.plan.md`
**Authorization:** proprietário do canal em ambas as rotas

**Description:** Completa o plano de controle multipart sem transferir bytes pela API, publica trabalho durável e permite encerrar rascunhos abandonados.

**Technical actions:**

1. Criar `src/videos/dto/complete-video-upload.dto.ts` com a lista ordenada de `{ part_number, e_tag }` do contrato de conclusão.
2. Adicionar `POST /channels/:channelId/videos/:videoId/complete-upload`, retornando `202` com `{ id, public_id, status: DRAFT, processing_queued: true }` após a confirmação storage/outbox.
3. Adicionar `DELETE /channels/:channelId/videos/:videoId/upload`, retornando `204` após abortar e remover somente o rascunho permitido.
4. Documentar no Swagger os erros de expiração, partes inválidas, limite real, transição inválida e propriedade com o envelope compartilhado.

**Tests:** _(empty — controller contract scenarios are owned by the pending Test Specs)_

**Dependencies:** SI-03.4 — complete, cancelamento e erros de domínio; SI-03.5 — publicação da outbox

**Acceptance criteria:**

- `POST /channels/:channelId/videos/:videoId/complete-upload` com ETags ordenados retorna `202`, mantém o vídeo em `DRAFT` e deixa processamento enfileirado.
- Uma lista de partes inválida retorna `422 MULTIPART_COMPLETION_INVALID`; um objeto confirmado acima de 10 GB retorna `413 VIDEO_SIZE_LIMIT_EXCEEDED`.
- Repetir uma conclusão aceita não cria outra outbox `video.process`.
- `DELETE /channels/:channelId/videos/:videoId/upload` de um rascunho do proprietário retorna `204`; outro usuário recebe `403 CHANNEL_ACCESS_DENIED`.

---

### SI-03.8 — Executar worker de processamento de mídia

**Description:** Isola FFmpeg e `ffprobe` num processo/container worker que consome a fila, controla os estados e remove recursos temporários em sucesso, retry ou encerramento.

**Technical actions:**

1. Criar `src/video-worker.ts` e `src/videos/video-worker.module.ts` para inicializar somente as dependências de configuração, TypeORM, fila, storage e processamento requeridas pelo consumidor (per `phase-03-videos/TD-01` and `phase-03-videos/TD-08`).
2. Criar `nestjs-project/Dockerfile.worker`, atualizar `package.json` com `start:worker` e estender `compose.yaml` com o serviço `video-worker`, sem porta HTTP e com dependências healthy de `db`, `minio` e `redis`.
3. Criar `src/videos/video-media-processor.service.ts` para baixar o objeto para diretório temporário, executar `ffprobe` para duração/metadados e FFmpeg para um frame thumbnail, e limpar arquivos em `finally` (per `phase-03-videos/TD-08`).
4. Criar `src/videos/video-worker.processor.ts` que reivindica `DRAFT → PROCESSING`, recarrega o vídeo pelo `videoId`, persiste metadados/chave do thumbnail em `READY`, rethrow em falha retryable e fixa `ERROR` após a última tentativa (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`, and `phase-03-videos/TD-08`).
5. Criar `src/videos/video-upload-cleanup.service.ts` para limpar rascunhos expirados e integrar desligamento gracioso do worker, sem deixar job ou arquivo temporário órfão.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoWorkerModule` | Unit: compilação DI do processo sem controller HTTP | `nestjs-project/src/videos/video-worker.module.spec.ts` |
| `VideoWorkerProcessor` | Unit: transições idempotentes, retry e erro terminal com dependências de fronteira mockadas | `nestjs-project/src/videos/video-worker.processor.spec.ts` |
| Video media pipeline | Integration: PostgreSQL, Redis, MinIO, FFmpeg e `ffprobe` reais processam fixture pequena e salvam thumbnail | `nestjs-project/src/videos/video-worker.processor.integration-spec.ts` |

**Dependencies:** SI-03.1 — serviços Compose; SI-03.2 — estados persistidos; SI-03.3 — storage; SI-03.5 — entrega de jobs

**Acceptance criteria:**

- `video-worker` inicia como serviço separado e `ffmpeg -version` e `ffprobe -version` funcionam dentro de sua imagem.
- Consumir `video.process` para um rascunho válido o move para `PROCESSING`, grava duração/metadados, cria thumbnail privada e termina em `READY`.
- Uma entrega duplicada para vídeo `READY` não reprocessa a mídia nem retrocede o estado.
- Uma falha retryable é tentada até três vezes; a última falha deixa o vídeo em `ERROR` com `error_code` seguro.
- O worker remove arquivos temporários e sessões multipart expiradas sem atingir mídia pronta.

---

### SI-03.9 — Implementar entrega privada por range e download

**Description:** Centraliza a resolução por `public_id`, propriedade e headers de mídia para que streaming e download nunca exponham a topologia do storage.

**Technical actions:**

1. Criar `src/videos/video-delivery.service.ts` para resolver `public_id`, exigir status `READY` e verificar o proprietário antes de abrir o objeto privado (per `phase-03-videos/TD-05` and `phase-03-videos/TD-06`).
2. Criar `src/videos/http-range.parser.ts` para aceitar uma única faixa byte válida e produzir `RANGE_NOT_SATISFIABLE` antes de chamar storage quando a faixa for inválida.
3. Converter o resultado de `StorageService.getObject` em resposta de streaming com `Accept-Ranges`, `Content-Range`, `Content-Length` e `Content-Type` exatos, sem buffer da API (per `phase-03-videos/TD-05`).
4. Construir headers de download com `Content-Disposition: attachment` e `original_filename` codificado com segurança, preservando os mesmos controles de acesso e estado.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `http-range.parser` | Unit: faixas válidas, inválidas, limites e casos sem header | `nestjs-project/src/videos/http-range.parser.spec.ts` |
| `VideoDeliveryService` | Unit: proprietário, estado `READY` e mapeamento de erros de domínio | `nestjs-project/src/videos/video-delivery.service.spec.ts` |
| Delivery service | Integration: MinIO real retorna faixa, metadados e arquivo privado correto | `nestjs-project/src/videos/video-delivery.service.integration-spec.ts` |

**Dependencies:** SI-03.2 — vídeo e `public_id`; SI-03.3 — leitura de objeto por range

**Acceptance criteria:**

- Um proprietário com vídeo `READY` e `Range: bytes=0-99` obtém os bytes solicitados com `Content-Range` e `Accept-Ranges: bytes`.
- Uma faixa inválida ou fora do objeto retorna `416 RANGE_NOT_SATISFIABLE` antes de transmitir conteúdo.
- Um vídeo `DRAFT`, `PROCESSING` ou `ERROR` retorna `409 VIDEO_NOT_READY` para entrega.
- Um não proprietário recebe `403 VIDEO_ACCESS_DENIED` e não recebe bucket, key, stream ou metadados privados.

---

### SI-03.10 — Expor streaming e download autenticados

**Route:** GET /videos/:publicId/stream; GET /videos/:publicId/download
**Test Specs:** see `nestjs-project/specs/video-delivery.plan.md`
**Authorization:** proprietário do canal do vídeo resolvido por `public_id`

**Description:** Conecta as rotas de entrega ao serviço de mídia, preservando `206 Partial Content`, download seguro e documentação OpenAPI sem mover regras de negócio ao controller.

**Technical actions:**

1. Criar o DTO/parâmetro UUID de `publicId` e adicionar `GET /videos/:publicId/stream` ao `VideosController`, encaminhando o header `Range` sem parse manual no controller.
2. Adicionar `GET /videos/:publicId/download` ao mesmo controller, delegando filename e headers de attachment a `VideoDeliveryService`.
3. Escrever a resposta Express de streaming de forma a encaminhar o stream de storage e status `206`/`200` sem buffering ou captura de exceção local.
4. Documentar no Swagger respostas `200`, `206`, `401`, `403`, `404`, `409` e `416` e registrar o `VideosModule` no `AppModule`.

**Tests:** _(empty — controller contract scenarios are owned by the pending Test Specs)_

**Dependencies:** SI-03.6 — controller e convenções OpenAPI; SI-03.9 — resolução e entrega privada

**Acceptance criteria:**

- `GET /videos/:publicId/stream` com `Range: bytes=0-99` retorna `206` com `Content-Range`, `Content-Length`, `Content-Type` e `Accept-Ranges: bytes` corretos.
- O mesmo endpoint sem `Range` retorna `200` transmitindo o objeto pronto sem exigir download prévio.
- `GET /videos/:publicId/download` retorna `200` com `Content-Disposition: attachment` e filename seguro.
- Sem token ou com usuário de outro canal, ambas as rotas retornam respectivamente `401` ou `403 VIDEO_ACCESS_DENIED` sem revelar a localização do storage.

---

### SI-03.11 — Fluxo funcional de vídeos (cross-layer)

**Description:** Exercita a integração real entre API, PostgreSQL, MinIO, Redis, worker e FFmpeg para evidenciar limites, sucesso, falha e entrega privada ponta a ponta.
**Test Specs:** see `nestjs-project/specs/video-pipeline.plan.md`

**Technical actions:**

1. Criar helpers em `src/test/video-fixtures.ts` para vídeo pequeno válido, multipart direto, polling de estado e limpeza dos objetos/filas usados pelas suítes.
2. Criar a suíte de integração do pipeline para verificar criação do rascunho, upload direto, outbox, Redis, worker, `ffprobe`, thumbnail e `READY` com infraestrutura Compose real.
3. Cobrir o limite de `10_000_000_000` tanto na criação quanto no `HeadObject` de conclusão, demonstrando que a API processa somente controle e não o arquivo inteiro.
4. Cobrir mídia inválida/erro de processamento até retries esgotarem e o registro chegar a `ERROR` sem corromper entregas duplicadas.
5. Cobrir via HTTP a autorização de dono, `206 Partial Content`, `Content-Range` e headers de download para mídia pronta.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Video pipeline | Integration: PostgreSQL + MinIO + Redis + worker + FFmpeg/ffprobe reais | `nestjs-project/src/videos/video-pipeline.integration-spec.ts` |

**Dependencies:** SI-03.7 — rotas de conclusão; SI-03.8 — worker; SI-03.10 — entrega HTTP

**Acceptance criteria:**

- Um upload válido menor que 10 GB transfere bytes diretamente ao MinIO, chega a `READY` e possui duração, metadados e thumbnail persistidos.
- Uma tentativa acima de 10 GB é rejeitada com `413 VIDEO_SIZE_LIMIT_EXCEEDED` sem o corpo do arquivo atravessar a API.
- Uma mídia que falha no processamento é repetida e termina em `ERROR`; uma mensagem duplicada não corrompe o estado.
- Uma requisição owner para streaming por faixa retorna `206` e `Content-Range` adequado; download retorna attachment com headers corretos.
- Um usuário sem propriedade não conclui upload nem recebe conteúdo ou metadados de mídia de outro canal.

---

### SI-03.12 — Consolidar documentação e verificação final

**Description:** Publica a arquitetura real de vídeos para agentes e consumidores da API, revisa o contrato exportado e executa os gates de qualidade da fase.

**Technical actions:**

1. Atualizar `AGENTS.md` como o equivalente Codex do `CLAUDE.md` com módulo `videos`, endpoints, MinIO, Redis, worker, FFmpeg/ffprobe, estado privado e regras de hosts Compose.
2. Atualizar `nestjs-project/AGENTS.md` quando os comandos, serviços ou convenções de teste do backend passarem a incluir storage, fila e worker.
3. Exportar/revisar `nestjs-project/openapi.json` e suas verificações para refletir todas as rotas, respostas parciais, autorização e envelope de erro de vídeos (per `openapi-docs-nestjs/TD-02`).
4. Executar migrations e os gates documentados dentro de `nestjs-api`; revisar efeitos automáticos do lint e garantir que documentação cite somente caminhos e comportamentos implementados.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| OpenAPI export | Integration: documento inclui os contratos de vídeo e o envelope compartilhado | `nestjs-project/src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.1 through SI-03.11 — infraestrutura, comportamento e contratos finais disponíveis

**Acceptance criteria:**

- `AGENTS.md` descreve somente o módulo, serviços, endpoints, storage, fila e worker que existem no código final.
- O OpenAPI exportado lista todas as rotas de upload, streaming e download com seus status e respostas previsíveis.
- `docker compose exec nestjs-api npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit`, `npm run lint` e `npm run build` terminam com código `0`.
- A revisão final não introduz publicação, categorias, colaboração ou edição completa pertencentes à Fase 04.

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | uuid | PK, generated; internal identifier only |
| `channel_id` | uuid | FK to `channels.id`, not null, `ON DELETE CASCADE` |
| `public_id` | uuid | not null, unique; opaque identifier used in product URLs |
| `status` | enum | `DRAFT`, `PROCESSING`, `READY`, `ERROR`; default `DRAFT` |
| `title` | varchar(255) | not null; initial video title set when the draft is created, editable only in Phase 04 |
| `original_filename` | varchar(255) | not null; response/download metadata only, never a storage key |
| `content_type` | varchar(255) | not null; allowlisted video MIME type |
| `size_bytes` | bigint | not null; positive and at most `10_000_000_000` |
| `storage_key` | varchar(512) | not null; opaque private-object key, never returned by the API |
| `thumbnail_key` | varchar(512) | nullable; opaque private-object key, set only after successful processing |
| `multipart_upload_id` | varchar(512) | nullable; persisted only while the `DRAFT` multipart session is active |
| `multipart_expires_at` | timestamptz | nullable; rejects and cleans abandoned/expired `DRAFT` uploads |
| `duration_seconds` | integer | nullable; populated by `ffprobe` only after successful processing |
| `metadata` | jsonb | nullable; selected, non-sensitive `ffprobe` metadata only |
| `processing_attempts` | smallint | not null, default `0`; records worker attempts |
| `error_code` | varchar(64) | nullable; terminal diagnostic code only, no storage credentials or raw command output |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

**Relations:** `Channel` has many `Video`; `Video` belongs to one `Channel` through the explicit `channel_id` FK. The migration and entities add both sides of this relation; API response DTOs expose neither internal keys nor `multipart_upload_id`.

**Indexes:** unique `public_id`; index `(channel_id, status)` for owner-scoped lookups; index `(status, multipart_expires_at)` for abandoned-upload cleanup. Status changes use conditional updates so duplicate completion and at-least-once jobs cannot move a terminal record backwards.

#### VideoOutbox

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | uuid | PK, generated |
| `video_id` | uuid | FK to `videos.id`, not null, `ON DELETE CASCADE` |
| `event_type` | varchar(64) | not null; first value is `video.process` |
| `payload` | jsonb | not null; exact queue payload `{ "version": 1, "videoId": "uuid" }` |
| `occurred_at` | timestamptz | default now() |
| `published_at` | timestamptz | nullable; set only after BullMQ accepts the job |
| `publish_attempts` | smallint | not null, default `0` |
| `last_error` | text | nullable; operational diagnostic with no secret material |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

**Relations:** `Video` has many `VideoOutbox` records; an outbox writer and the video transition are committed in the same PostgreSQL transaction.

**Indexes:** unique `(video_id, event_type)` for the single processing event; index `(published_at, occurred_at)` for publisher recovery scans.

### API Contracts

All endpoints below are backend contracts protected by the existing global JWT guard, documented in Swagger/OpenAPI, and use the inherited error envelope `{ statusCode, error, message }`. The API is only the control plane: multipart bytes travel between the client and MinIO/S3 through per-part pre-signed URLs; no API handler accepts, buffers, or proxies an upload body.

#### POST /channels/:channelId/videos/uploads (SI-03.6)

**Request headers:**

- `Authorization: Bearer <access-token>`
- `Content-Type: application/json`

**Request body:**

- `original_filename`: string, required — non-empty, at most 255 characters
- `title`: string, required — non-empty, at most 255 characters; creates the initial draft title
- `content_type`: string, required — allowlisted video MIME type
- `size_bytes`: integer, required — greater than zero and at most `10_000_000_000`

**Response 201:**

- `id`: UUID — video resource identifier for the multipart control-plane endpoints
- `public_id`: UUID — opaque product URL identifier; no storage-key information
- `status`: `DRAFT`
- `part_size_bytes`: integer — server-selected multipart part size
- `upload_expires_at`: ISO 8601 timestamp

**Error responses:**

- 400 `VALIDATION_ERROR`: malformed UUID or body
- 403 `CHANNEL_ACCESS_DENIED`: authenticated user does not own `channelId`
- 404 `CHANNEL_NOT_FOUND`: channel does not exist
- 413 `VIDEO_SIZE_LIMIT_EXCEEDED`: declared size is above 10 GB
- 415 `UNSUPPORTED_VIDEO_MEDIA_TYPE`: content type is not allowlisted

---

#### POST /channels/:channelId/videos/:videoId/upload-parts (SI-03.6)

**Request headers:**

- `Authorization: Bearer <access-token>`
- `Content-Type: application/json`

**Request body:**

- `part_numbers`: non-empty array of distinct positive integers — requested multipart part numbers

**Response 200:**

- `parts`: array of `{ part_number, url, expires_at }` — short-lived pre-signed `UploadPart` URLs

**Error responses:**

- 400 `VALIDATION_ERROR`: invalid part-number shape
- 403 `CHANNEL_ACCESS_DENIED`: caller is not the channel owner
- 404 `VIDEO_NOT_FOUND`: video does not belong to the supplied channel
- 409 `VIDEO_UPLOAD_NOT_DRAFT`: video is no longer accepting multipart parts
- 410 `MULTIPART_UPLOAD_EXPIRED`: session expired or was cleaned up

---

#### POST /channels/:channelId/videos/:videoId/complete-upload (SI-03.7)

**Request headers:**

- `Authorization: Bearer <access-token>`
- `Content-Type: application/json`

**Request body:**

- `parts`: ordered, non-empty array of `{ part_number, e_tag }` values captured from successful direct uploads

**Response 202:**

- `id`: UUID
- `public_id`: UUID
- `status`: `DRAFT`
- `processing_queued`: `true`

The service completes the S3 multipart upload, obtains `HeadObject`, verifies the actual object size is no more than `10_000_000_000`, and writes the `video.process` outbox record in the same transaction that records completion. The worker, not the HTTP controller, conditionally moves the video from `DRAFT` to `PROCESSING` before media work. Repeating a completed request must not create another outbox event.

**Error responses:**

- 400 `VALIDATION_ERROR`: invalid parts or ETags
- 403 `CHANNEL_ACCESS_DENIED`: caller is not the channel owner
- 404 `VIDEO_NOT_FOUND`: video does not belong to the supplied channel
- 409 `VIDEO_UPLOAD_NOT_DRAFT`: upload was cancelled or already reached processing/terminal state
- 410 `MULTIPART_UPLOAD_EXPIRED`: session expired or was cleaned up
- 413 `VIDEO_SIZE_LIMIT_EXCEEDED`: `HeadObject` reports more than 10 GB
- 422 `MULTIPART_COMPLETION_INVALID`: storage rejects the ordered part list

---

#### DELETE /channels/:channelId/videos/:videoId/upload (SI-03.7)

**Request headers:**

- `Authorization: Bearer <access-token>`

**Response 204:** No content. The service aborts the storage multipart upload when present and deletes the `DRAFT` record.

**Error responses:**

- 403 `CHANNEL_ACCESS_DENIED`: caller is not the channel owner
- 404 `VIDEO_NOT_FOUND`: video does not belong to the supplied channel
- 409 `VIDEO_UPLOAD_NOT_DRAFT`: cancellation is not allowed after processing begins

---

#### GET /videos/:publicId/stream (SI-03.10)

**Request headers:**

- `Authorization: Bearer <access-token>`
- `Range: bytes=<start>-<end>` — optional, validated byte range

**Response 206:** When `Range` is supplied, stream only the requested bytes with `Accept-Ranges: bytes`, exact `Content-Range`, `Content-Length`, and stored `Content-Type`. The API forwards the S3 object stream without buffering it in process memory.

**Response 200:** When `Range` is omitted, stream the complete ready object with `Accept-Ranges: bytes` and stored `Content-Type`.

**Error responses:**

- 401: missing or invalid access token
- 403 `VIDEO_ACCESS_DENIED`: authenticated user does not own the video's channel
- 404 `VIDEO_NOT_FOUND`: public identifier does not resolve to a video
- 409 `VIDEO_NOT_READY`: video is `DRAFT`, `PROCESSING`, or `ERROR`
- 416 `RANGE_NOT_SATISFIABLE`: range is malformed or outside object length

---

#### GET /videos/:publicId/download (SI-03.10)

**Request headers:**

- `Authorization: Bearer <access-token>`

**Response 200:** Streams the ready private object with stored `Content-Type`, exact `Content-Length`, `Accept-Ranges: bytes`, and `Content-Disposition: attachment` using a safely encoded `original_filename`. The API never reveals the bucket, object key, credentials, or a permanent storage URL.

**Error responses:**

- 401: missing or invalid access token
- 403 `VIDEO_ACCESS_DENIED`: authenticated user does not own the video's channel
- 404 `VIDEO_NOT_FOUND`: public identifier does not resolve to a video
- 409 `VIDEO_NOT_READY`: video is not `READY`

#### Validation Rules — video upload and delivery

- All `channelId`, `videoId`, and `publicId` path values are UUIDs; controllers use DTO validation or a UUID pipe instead of manual parsing.
- `title` and `original_filename` are non-empty strings up to 255 characters; changing a title after draft creation is explicitly deferred to Phase 04.
- `size_bytes` is an integer in `(0, 10_000_000_000]`; completion repeats the limit against `HeadObject` rather than trusting client metadata.
- A create request accepts only configured video MIME types; filename is treated as metadata and is never used in object-key construction.
- A pre-sign request accepts distinct positive part numbers; completion accepts a non-empty, strictly ascending part list with non-empty ETags.
- `Range` is parsed before storage access and supports one byte range only; invalid/unsatisfiable values map to `RANGE_NOT_SATISFIABLE`.

### Authorization Matrix

Every route remains protected by the existing global JWT guard. In this phase, all video media is private: visibility/publication policy and non-owner playback belong to Phase 04 and must not be introduced here.

| Endpoint | Anonymous | Authenticated non-owner | Channel owner | Authorization rule |
|----------|-----------|-------------------------|---------------|--------------------|
| `POST /channels/:channelId/videos/uploads` | 401 | 403 | allowed | Load `Channel` by `channelId` and require `channel.user_id === currentUser.sub` before creating a draft or multipart session. |
| `POST /channels/:channelId/videos/:videoId/upload-parts` | 401 | 403 | allowed | Resolve video through its channel and require the same owner before signing any part URL. |
| `POST /channels/:channelId/videos/:videoId/complete-upload` | 401 | 403 | allowed | Require owner before completing the multipart upload, writing outbox work, or changing state. |
| `DELETE /channels/:channelId/videos/:videoId/upload` | 401 | 403 | allowed | Require owner before aborting storage or removing an active draft. |
| `GET /videos/:publicId/stream` | 401 | 403 | allowed | Resolve `public_id` internally, then require the resolved video's channel owner before opening the private object stream. |
| `GET /videos/:publicId/download` | 401 | 403 | allowed | Resolve `public_id` internally, then require the resolved video's channel owner before opening the private object stream. |

Ownership evaluation belongs in a service/repository query or a guard that delegates to that service; controllers only pass the current JWT payload and validated route values. A failed ownership lookup returns a domain exception through the existing exception filter and never exposes a storage key, multipart upload ID, or another channel's media metadata.

### Error Catalog

All domain errors use the inherited JSON envelope `{ statusCode, error, message }`; services throw domain exceptions, controllers do not format error bodies, and raw MinIO/S3, Redis, FFmpeg, `ffprobe`, filesystem paths, and command output are logged only with safe context.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| `CHANNEL_NOT_FOUND` | 404 | `channelId` has no channel record. |
| `CHANNEL_ACCESS_DENIED` | 403 | Authenticated caller is not the owner of the target channel. |
| `VIDEO_NOT_FOUND` | 404 | `videoId` or `publicId` does not resolve within the requested resource scope. |
| `VIDEO_ACCESS_DENIED` | 403 | Authenticated caller is not the owner of the video resolved from `publicId`. |
| `VIDEO_SIZE_LIMIT_EXCEEDED` | 413 | Declared or storage-confirmed object size exceeds `10_000_000_000` bytes. |
| `UNSUPPORTED_VIDEO_MEDIA_TYPE` | 415 | Create request MIME type is outside the configured video allowlist. |
| `VIDEO_UPLOAD_NOT_DRAFT` | 409 | Part signing, completion, or cancellation is attempted after the `DRAFT` lifecycle is no longer active. |
| `MULTIPART_UPLOAD_EXPIRED` | 410 | Persisted multipart session expired or cleanup aborted it. |
| `MULTIPART_COMPLETION_INVALID` | 422 | Storage rejects the ordered part number/ETag list. |
| `VIDEO_NOT_READY` | 409 | Stream or download is requested while status is `DRAFT`, `PROCESSING`, or `ERROR`. |
| `RANGE_NOT_SATISFIABLE` | 416 | Requested byte range is malformed or outside the ready object's length. |
| `STORAGE_UNAVAILABLE` | 503 | A control-plane storage call fails transiently before a response can be completed. |

Worker failures are not sent synchronously to the upload client. They rethrow to BullMQ for the configured retries; only after the final attempt is the video moved to `ERROR` with a safe `error_code`. The delivery endpoints then return `VIDEO_NOT_READY`, not worker internals.

### Events/Messages

#### video.process

**Payload:**

```json
{ "version": 1, "videoId": "uuid" }
```

**Producer:** `VideoOutboxPublisher` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`, and `phase-03-videos/TD-09`)

**Consumer:** `VideoWorkerProcessor` in the separate `video-worker` process (per `phase-03-videos/TD-01` and `phase-03-videos/TD-08`)

**Trigger:** `complete-upload` has successfully completed the storage multipart upload and verified the object size. In the same PostgreSQL transaction, the application records a single unpublished outbox row. The publisher scans unpublished rows and adds the job with `jobId = videoId`; it marks the row published only after BullMQ accepts it. An interrupted publish is retried from the outbox.

**Delivery semantics:** at-least-once. BullMQ uses `attempts: 3` with exponential backoff and a deterministic `jobId = videoId`; the worker reloads the video by ID and never trusts queue data as a mutable snapshot.

**Idempotency and state transitions:** the worker performs an atomic `DRAFT → PROCESSING` claim before downloading. A duplicate or stale delivery that finds `READY` exits successfully; one that finds `PROCESSING` does not perform concurrent FFmpeg work; a terminal `ERROR` is not reset. After `ffprobe` succeeds and FFmpeg stores the thumbnail, one guarded transition writes metadata and moves `PROCESSING → READY`. A retryable failure is rethrown; the final failure writes a safe `error_code` and moves `PROCESSING → ERROR`.

**Operational cleanup:** a worker-owned cleanup task periodically selects expired `DRAFT` sessions by `multipart_expires_at`, aborts their storage multipart upload, and removes the draft. It is not an HTTP event and must be safe to run more than once.

---

## Dependency Map

SI-03.1 (root — infraestrutura e configuração)
├── SI-03.2 — depends on SI-03.1 (schema e serviços locais)
│   ├── SI-03.4 — depends on SI-03.2 + SI-03.3 (ciclo multipart persistido)
│   │   ├── SI-03.5 — depends on SI-03.1 + SI-03.2 + SI-03.4 (outbox para Redis)
│   │   │   ├── SI-03.6 — depends on SI-03.4 + SI-03.5 (início e assinatura HTTP)
│   │   │   ├── SI-03.7 — depends on SI-03.4 + SI-03.5 (conclusão e cancelamento HTTP)
│   │   │   └── SI-03.8 — depends on SI-03.1 + SI-03.2 + SI-03.3 + SI-03.5 (worker)
│   └── SI-03.9 — depends on SI-03.2 + SI-03.3 (entrega privada)
│       └── SI-03.10 — depends on SI-03.6 + SI-03.9 (streaming e download HTTP)
├── SI-03.3 — depends on SI-03.1 (fronteira MinIO/S3)
└── SI-03.11 — depends on SI-03.7 + SI-03.8 + SI-03.10 (fluxo real ponta a ponta)
    └── SI-03.12 — depends on SI-03.1 through SI-03.11 (documentação e gates finais)

---

## Deliverables

- [ ] SI-03.1 — Provisionar infraestrutura de storage e fila
- [ ] SI-03.2 — Persistir vídeos e outbox de processamento
- [ ] SI-03.3 — Integrar storage multipart privado
- [ ] SI-03.4 — Implementar ciclo de vida do upload
- [ ] SI-03.5 — Publicar eventos duráveis de processamento
- [ ] SI-03.6 — Expor início e assinatura de upload
- [ ] SI-03.7 — Expor conclusão e cancelamento de upload
- [ ] SI-03.8 — Executar worker de processamento de mídia
- [ ] SI-03.9 — Implementar entrega privada por range e download
- [ ] SI-03.10 — Expor streaming e download autenticados
- [ ] SI-03.11 — Fluxo funcional de vídeos (cross-layer)
- [ ] SI-03.12 — Consolidar documentação e verificação final

**Full test suites:**

- [ ] Backend unit tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] Backend integration tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:integration`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
