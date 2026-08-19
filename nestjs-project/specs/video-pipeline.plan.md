---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: nestjs-project/test/video-pipeline.e2e-spec.ts
---

# Video Pipeline Test Plan

## Application Overview

Verifica o fluxo backend cross-service entre API, PostgreSQL, MinIO, Redis, worker, FFmpeg e ffprobe, desde o upload direto até a entrega privada ou falha terminal.

## Test Scenarios

### 1. End-to-end media processing

**Setup:** Subir os serviços Compose reais, truncar dados e filas de teste, preparar um fixture de vídeo pequeno válido e tokens para dois proprietários de canal; executar o worker separado com FFmpeg e ffprobe disponíveis.

#### 1.1. process-direct-upload-to-ready

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Criar um rascunho por HTTP, enviar o fixture diretamente ao MinIO pelas URLs multipart e concluir o upload.
    - expect: os bytes não passam pelo processo da API e a outbox publica um único job `video.process`.
  2. Aguardar o worker consumir o job.
    - expect: o vídeo chega a `READY` com duração, metadados e thumbnail persistidos.

#### 1.2. reject-over-limit-without-api-body-transfer

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Tentar iniciar upload acima de `10000000000` bytes e concluir um objeto cujo `HeadObject` excede o limite.
    - expect: ambas as tentativas retornam `413` com `VIDEO_SIZE_LIMIT_EXCEEDED`.
    - expect: nenhuma rota aceita ou mantém o corpo completo da mídia em memória.

#### 1.3. retry-invalid-media-and-ignore-duplicate-job

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Concluir um objeto de mídia inválida e aguardar as tentativas configuradas do worker.
    - expect: o job é repetido e o vídeo termina em `ERROR` com erro seguro, sem estado intermediário corrompido.
  2. Entregar novamente a mensagem `video.process` para o mesmo vídeo.
    - expect: a entrega duplicada não retrocede nem duplica o estado ou os artefatos persistidos.

#### 1.4. deliver-ready-media-through-http

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Com o vídeo pronto, solicitar streaming por faixa como proprietário.
    - expect: resposta `206` e `Content-Range` adequado ao conteúdo real do MinIO.
  2. Solicitar download do mesmo vídeo.
    - expect: resposta attachment com headers de mídia corretos e sem URL de storage.

#### 1.5. deny-non-owner-across-upload-and-delivery

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Usar um token de outro canal para concluir o upload e, depois, acessar streaming e download do vídeo.
    - expect: a conclusão e as entregas retornam `403`.
    - expect: o chamador não recebe metadados, conteúdo ou localização interna de mídia de outro canal.
