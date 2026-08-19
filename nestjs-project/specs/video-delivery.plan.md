---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: nestjs-project/test/video-delivery.e2e-spec.ts
---

# Video Delivery Test Plan

## Application Overview

Verifica streaming e download autenticados de objetos privados resolvidos apenas por `public_id`, preservando os headers HTTP de mídia e sem revelar a topologia do storage.

## Test Scenarios

### 1. Private streaming and download

**Setup:** Truncar dados de teste, iniciar `AppModule` com configuração global de produção e preparar no MinIO local um vídeo `READY` com conteúdo conhecido e canais de proprietário e não proprietário.

#### 1.1. stream-requested-byte-range

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Enviar `GET /videos/:publicId/stream` como proprietário com `Range: bytes=0-99`.
    - expect: resposta `206` com `Content-Range`, `Content-Length`, `Content-Type` e `Accept-Ranges: bytes` exatos.
    - expect: o corpo contém somente a faixa solicitada.

#### 1.2. stream-ready-object-without-range

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Enviar `GET /videos/:publicId/stream` como proprietário sem header `Range`.
    - expect: resposta `200` transmitindo todo o objeto pronto com `Content-Type` e `Accept-Ranges: bytes`.
    - expect: nenhum download prévio ou URL de storage é exigido.

#### 1.3. download-as-safe-attachment

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Enviar `GET /videos/:publicId/download` como proprietário.
    - expect: resposta `200` com `Content-Disposition: attachment`, filename codificado com segurança, `Content-Length` e `Content-Type` corretos.
    - expect: a resposta não revela bucket, object key, credenciais ou URL permanente.

#### 1.4. enforce-media-ownership

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-08-19T04:19:48Z

**Steps:**
  1. Solicitar streaming e download sem token.
    - expect: ambas as rotas retornam `401`.
  2. Solicitar as mesmas rotas com token de outro canal.
    - expect: ambas retornam `403` com `VIDEO_ACCESS_DENIED`, sem headers ou detalhes internos do storage.
