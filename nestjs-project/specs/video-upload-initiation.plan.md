---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/video-upload-initiation.e2e-spec.ts
---

# Video Upload Initiation Test Plan

## Application Overview

Verifica o plano de controle autenticado que cria o rascunho de vídeo e fornece URLs multipart de curta duração, sem receber bytes nem expor chaves internas do storage.

## Test Scenarios

### 1. Upload initiation and part signing

**Setup:** Truncar os dados de teste, iniciar `AppModule` com a configuração global de produção e preparar tokens de dois proprietários de canais distintos; usar PostgreSQL e MinIO locais reais.

#### 1.1. create-draft-without-storage-key

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Enviar `POST /channels/:channelId/videos/uploads` com token do proprietário, título, nome original, MIME permitido e tamanho válido.
    - expect: resposta `201` com `id`, `public_id`, `status: DRAFT`, `part_size_bytes` e `upload_expires_at`.
    - expect: a resposta não contém chave, bucket, upload ID ou credencial de storage.
    - expect: o rascunho fica ligado somente ao canal do proprietário.

#### 1.2. reject-declared-size-above-10-gb

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Enviar a mesma criação com `size_bytes: 10000000001`.
    - expect: resposta `413` no envelope de erro com `VIDEO_SIZE_LIMIT_EXCEEDED`.
    - expect: nenhum rascunho, sessão multipart ou objeto é criado.

#### 1.3. sign-distinct-multipart-parts

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Criar um rascunho válido e enviar `POST /channels/:channelId/videos/:videoId/upload-parts` com números de partes distintos e positivos.
    - expect: resposta `200` com uma URL temporária e `expires_at` para cada parte solicitada.
    - expect: a resposta não contém chaves internas, bucket, credenciais ou URL permanente.

#### 1.4. deny-non-owner-before-signing

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Usar o token de outro canal para criar upload no canal alheio.
    - expect: resposta `403` com `CHANNEL_ACCESS_DENIED` e nenhuma sessão é criada.
  2. Usar o mesmo token para solicitar partes de um rascunho do proprietário.
    - expect: resposta `403` com `CHANNEL_ACCESS_DENIED` e nenhuma URL é retornada.
