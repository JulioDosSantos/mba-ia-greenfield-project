---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: nestjs-project/test/video-upload-completion.e2e-spec.ts
---

# Video Upload Completion Test Plan

## Application Overview

Verifica a confirmação idempotente do multipart e o cancelamento de rascunhos, incluindo a publicação durável do trabalho de processamento sem transportar mídia pela API.

## Test Scenarios

### 1. Upload completion and cancellation

**Setup:** Truncar dados de teste, iniciar `AppModule` com configuração global de produção, criar canais de proprietário e não proprietário e preparar uma sessão multipart no MinIO local.

#### 1.1. complete-valid-upload-and-queue-processing

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Enviar `POST /channels/:channelId/videos/:videoId/complete-upload` com partes em ordem estrita e ETags válidos de um upload multipart real.
    - expect: resposta `202` com `id`, `public_id`, `status: DRAFT` e `processing_queued: true`.
    - expect: existe exatamente um evento `video.process` pendente para o vídeo, sem mudar o status para processamento no controller.

#### 1.2. reject-invalid-parts-and-oversize-confirmed-object

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Completar um upload com partes fora de ordem, repetidas ou ETag inválida.
    - expect: resposta `422` com `MULTIPART_COMPLETION_INVALID` e nenhum evento é publicado.
  2. Simular um `HeadObject` confirmado acima de `10000000000` bytes no limite de storage.
    - expect: resposta `413` com `VIDEO_SIZE_LIMIT_EXCEEDED` e nenhum job é enfileirado.

#### 1.3. keep-completion-idempotent

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Repetir uma conclusão já aceita com a mesma lista ordenada de partes.
    - expect: a resposta mantém o contrato de conclusão aceita.
    - expect: há somente uma outbox `video.process` e nenhum trabalho duplicado é criado.

#### 1.4. cancel-only-owner-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Enviar `DELETE /channels/:channelId/videos/:videoId/upload` com token do proprietário para um rascunho ativo.
    - expect: resposta `204`, abortando a sessão multipart e removendo somente o rascunho permitido.
  2. Repetir o cancelamento com token de outro canal.
    - expect: resposta `403` com `CHANNEL_ACCESS_DENIED` e o rascunho do proprietário permanece intacto.
