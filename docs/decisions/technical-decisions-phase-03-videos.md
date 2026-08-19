---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-08-18
scope_description: "Decisões de backend e infraestrutura para upload, processamento e entrega de vídeos da Fase 03."
---

# Technical Decisions — Phase 03: Videos

_Subprojects in scope:_

- `nestjs-project/` — receberá o módulo de vídeos, a infraestrutura de storage/fila/worker e os contratos HTTP; as escolhas abaixo cobrem suas integrações e fronteiras.
- `next-frontend/` — fora do escopo desta fase e desta pesquisa; não há decisão de frontend.

## Research basis

- O backend instalado usa NestJS 11, TypeORM 0.3 e PostgreSQL; ainda não há bibliotecas de fila nem de S3 no `package.json`.
- Context7 foi consultado para BullMQ, integração NestJS Bull e AWS SDK for JavaScript v3. BullMQ oferece `jobId` idempotente, retries com backoff exponencial e eventos globais; o SDK S3 cobre o ciclo `CreateMultipartUpload` → `UploadPart` → `CompleteMultipartUpload`/`AbortMultipartUpload` e URLs pré-assinadas.
- As versões exatas das novas dependências serão fixadas contra o lockfile no `$plan-resolve`; candidatos: `@nestjs/bullmq`, `bullmq`, `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner`.

---

## TD-01: Queue, isolated worker, and retry delivery policy

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** O processamento com FFmpeg não pode competir com as requisições HTTP. A fila precisa sobreviver a reinícios, permitir retries observáveis e tolerar entrega ao menos uma vez sem processar o mesmo vídeo duas vezes.

**Options:**

### Option A: BullMQ on Redis with a separate video-worker container
- A API publica um job `video.process` no Redis e um processo Nest dedicado, em outro container, o consome com FFmpeg e ffprobe instalados.
- Cada job usa `jobId = videoId`; o worker trata o estado persistido do vídeo como fonte de verdade e torna uma entrega duplicada inócua.
- **Pros:** integração direta com NestJS, retries e backoff exponencial nativos, jobs persistidos no Redis, eventos de fila e isolamento da carga de CPU da API.
- **Cons:** introduz Redis como serviço e exige tratar a fronteira não transacional PostgreSQL ↔ Redis.

### Option B: RabbitMQ with consumer and dead-letter queue próprios
- A API publica uma mensagem em RabbitMQ e o worker confirma ou rejeita manualmente o consumo, com retry e dead-letter configurados no broker.
- **Pros:** protocolo de mensageria maduro, roteamento flexível e DLQ explícita.
- **Cons:** requer mais topologia e código de ack/retry/idempotência; o ganho de roteamento não é necessário para uma única classe de job nesta fase.

### Option C: pg-boss on PostgreSQL
- Jobs são mantidos no PostgreSQL já existente e um processo separado os busca para processamento.
- **Pros:** elimina Redis e reduz a quantidade de serviços novos.
- **Cons:** FFmpeg e o polling disputam recursos com as transações da API; há menos aderência ao ecossistema Nest para eventos e operação de filas de vídeo.

**Recommendation:** Option A — BullMQ + Redis separa a carga de processamento, entrega os mecanismos de retry e deduplicação exigidos sem criar uma topologia de mensageria desproporcional.

**Decision:** A — BullMQ + Redis with a separate `video-worker` container; `video.process` uses `jobId = videoId`, three attempts with exponential backoff, and persisted video state for idempotency.

---

## TD-02: Direct multipart upload protocol for files up to 10 GB

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** Transportar 10 GB pela API prende conexões e memória à aplicação. O protocolo deve criar o vídeo como rascunho, limitar o upload a 10 GB, conferir propriedade e permitir concluir ou cancelar um multipart sem entregar credenciais permanentes ao cliente.

**Options:**

### Option A: API-orchestrated S3 multipart with per-part presigned URLs
- A API cria o registro `DRAFT` e a sessão multipart no MinIO/S3, mantendo os identificadores internos apenas no servidor; o cliente recebe identificadores opacos do vídeo e, na rota de assinatura de partes, capacidades pré-assinadas curtas. A conclusão recebe somente números das partes e ETags.
- A API confere usuário/canal, limite declarado, tipo aceito e estado antes de concluir; cancelar aborta o multipart.
- **Pros:** os bytes não passam pela API, funciona com MinIO local e S3 em produção, permite retomada por parte e mantém a autorização no backend.
- **Cons:** o contrato possui mais etapas e o cliente precisa guardar ETags e controlar expiração das URLs.

### Option B: Serviço tus dedicado com backend S3
- Um servidor tus recebe uploads retomáveis e os persiste no S3; a API integra a criação do vídeo e recebe um callback de conclusão.
- **Pros:** protocolo de retomada padronizado e cliente maduro para interrupções longas.
- **Cons:** adiciona serviço, protocolo e operação próprios; duplica a coordenação de autorização e estado já necessária para MinIO/S3.

### Option C: Credenciais temporárias com escopo de prefixo para o cliente executar o multipart
- A API emite credenciais temporárias limitadas ao prefixo do novo vídeo, e o cliente usa diretamente a API S3 para criar e concluir o multipart.
- **Pros:** reduz a quantidade de URLs que a API precisa emitir.
- **Cons:** amplia a superfície de segurança e o contrato de credenciais; é mais difícil limitar operações e diagnosticar o fluxo do que URLs por parte.

**Recommendation:** Option A — multipart pré-assinado preserva a API como plano de controle, deixa o plano de dados no storage e atende o limite sem introduzir um segundo serviço de upload.

**Decision:** A — API-orchestrated S3 multipart upload with short-lived, per-part presigned URLs; the API creates the `DRAFT`, validates completion, and aborts on cancellation.

---

## TD-03: Private MinIO/S3 layout and abandoned-upload cleanup

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** MinIO/S3 é uma restrição definida do projeto; a decisão aberta é como isolar objetos, evitar que nomes enviados pelo usuário virem chaves públicas e limpar sessões multipart ou objetos abandonados.

**Options:**

### Option A: One private media bucket with video-scoped prefixes
- Um bucket privado, por exemplo `streamtube-media`, usa chaves internas como `videos/{channelId}/{videoId}/source` e `thumbnails/{channelId}/{videoId}/thumbnail.jpg`; nenhum nome original integra a chave.
- Cancelamento e um job de limpeza abortam multiparts expirados e removem seus rascunhos incompletos; o worker limpa os arquivos temporários locais, enquanto o original concluído permanece privado para auditoria e eventual reprocessamento.
- **Pros:** uma política de acesso e um volume local, limpeza simples por prefixo e paridade direta entre MinIO e S3.
- **Cons:** regras de lifecycle e métricas de vídeos e thumbnails compartilham o mesmo bucket.

### Option B: Two private buckets, one for originals and one for thumbnails
- O original e a thumbnail são armazenados em buckets privados separados, ambos com prefixos por canal e vídeo.
- **Pros:** lifecycle, quota e permissões podem divergir por tipo de objeto.
- **Cons:** duplica bootstrap, configuração e políticas sem que a fase tenha requisitos diferentes de retenção ou acesso.

### Option C: One private bucket per channel
- Cada canal recebe seu próprio bucket para originais e thumbnails.
- **Pros:** forte separação administrativa por canal.
- **Cons:** cria buckets e políticas sem escala operacional adequada, torna inicialização e observabilidade mais complexas e não melhora a autorização da API.

**Recommendation:** Option A — um bucket privado com prefixos opacos oferece a separação necessária e a menor superfície operacional para a primeira fase de mídia.

**Decision:** A — one private media bucket with channel/video-scoped prefixes, explicit multipart cancellation, expiry cleanup, and local temporary-file cleanup by the worker.

---

## TD-04: Video state machine, terminal failure, and idempotency boundary

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** A conclusão do multipart, o consumidor da fila e possíveis reinícios podem ocorrer mais de uma vez. O banco precisa representar uma única evolução válida, distinguir falha definitiva e fornecer uma rotina de limpeza segura.

**Options:**

### Option A: Minimal persisted lifecycle with guarded transitions
- O vídeo nasce `DRAFT`; a conclusão idempotente finaliza o multipart, encerra a sessão ativa e grava uma outbox durável, ainda em `DRAFT`. O worker reivindica a transição atômica `DRAFT` → `PROCESSING`, move para `READY` somente depois de persistir metadados e thumbnail, ou para `ERROR` após esgotar três tentativas exponenciais.
- A sessão, a expiração e a referência interna do objeto ficam apenas no registro enquanto o upload está ativo; `complete` exige esse `DRAFT` ativo, e o worker não-opera para `READY` ou `ERROR` e usa a reivindicação condicional para evitar processamento concorrente.
- **Pros:** corresponde ao ciclo exigido, deixa o banco como fonte de verdade e torna conclusões/reentregas repetidas seguras sem expor estados internos de BullMQ.
- **Cons:** `DRAFT` cobre a pré-criação, o upload em andamento e a espera pela fila; detalhes operacionais precisam ficar em campos de sessão e na outbox.

### Option B: Lifecycle detalhado com `UPLOADING` e `QUEUED`
- O vídeo percorre `DRAFT` → `UPLOADING` → `QUEUED` → `PROCESSING` → `READY`/`ERROR`, com cada etapa persistida.
- **Pros:** diagnóstico mais granular e separação visual entre transferência e espera na fila.
- **Cons:** aumenta transições, contratos e casos de recuperação sem ser exigido por esta fase; estados podem divergir facilmente da fila.

### Option C: Apenas estado de upload e resultado final
- O vídeo fica `DRAFT` até o worker terminar e passa diretamente para `READY` ou `ERROR`; a fila é a única fonte do processamento intermediário.
- **Pros:** menor modelo de dados.
- **Cons:** não representa processamento no banco e não atende ao ciclo de status requerido nem a operações idempotentes baseadas no estado persistido.

**Recommendation:** Option A — quatro estados de negócio, transições condicionais e `jobId = videoId` conciliam simplicidade, recuperação e entrega ao menos uma vez.

**Decision:** A — `DRAFT` (active or queued) → `PROCESSING` → `READY`/`ERROR`, with conditional database transitions, idempotent completion, and a terminal `ERROR` after the retry policy is exhausted.

---

## TD-05: Opaque public URL and authenticated range/download delivery

**Scope:** Backend

**Capability:** Transversal — covers: "URL única por vídeo, sem conflito com outros vídeos", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** A URL pública não pode vazar a chave interna do storage ou conflitar entre canais. A entrega precisa suportar `Range`, responder `206 Partial Content` corretamente e manter a política de acesso desta fase, antes de visibilidade pública/unlisted da Fase 04.

**Options:**

### Option A: Database-unique opaque public ID with API range proxy
- Um `public_id` aleatório, imutável e único no banco resolve a URL; a API busca a chave interna, confere que o vídeo está `READY` e que o solicitante é dono do canal, então encaminha o `Range` ao S3 e devolve `206`, `Content-Range`, `Accept-Ranges` e `Content-Length`.
- Uma rota de download usa a mesma autorização e objeto, mas define `Content-Disposition: attachment`; streaming não define `Content-Disposition`.
- **Pros:** separa identificador público da chave S3, centraliza autorização e headers HTTP, e deixa a futura política de visibilidade ser adicionada sem expor o bucket.
- **Cons:** o tráfego de reprodução passa pela API, que deverá transmitir o stream sem bufferizar o objeto.

### Option B: URL legível por canal e título, com GET pré-assinado do S3
- A URL é formada por nickname do canal e slug do título; depois da autorização inicial, a API redireciona para uma URL pré-assinada do objeto.
- **Pros:** URLs memoráveis e menor tráfego de mídia na API.
- **Cons:** exige resolução de colisões e mudança de URL quando título/canal mudam; a autorização expira junto com a URL e a semântica de download/range fica distribuída no storage.

### Option C: Objetos públicos no MinIO/S3
- A URL resolve diretamente para um objeto público do bucket.
- **Pros:** entrega mais simples e direta pelo storage.
- **Cons:** ignora a autorização por canal, expõe chaves de armazenamento e antecipa a visibilidade pública que pertence à Fase 04.

**Recommendation:** Option A — um identificador opaco com proxy de byte range atende streaming e download agora, preservando a separação entre a URL do produto, o storage privado e a futura publicação.

**Decision:** A — a database-unique opaque `public_id` resolved through an owner-authorized API range proxy; streaming returns the proper `206` headers and download uses `Content-Disposition: attachment`.

---

## TD-06: Channel ownership and private-media authorization

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** A autenticação da Fase 02 identifica o usuário, mas o contrato ainda precisa decidir quem pode atuar sobre um canal e consumir um vídeo que não possui visibilidade pública antes da Fase 04.

**Options:**

### Option A: Owner-only authorization through the channel relation
- Cada operação recebe ou resolve `channelId`/`publicId`, carrega o canal e permite somente ao usuário autenticado cujo `channel.userId` corresponde ao recurso iniciar, assinar partes, concluir ou cancelar o upload; streaming e download de um vídeo `READY` seguem a mesma regra.
- `401` representa ausência de autenticação, `403` propriedade inválida e `404` recurso inexistente, sem vazar a referência interna do storage.
- **Pros:** reutiliza o modelo de canal já entregue, bloqueia enumeração de mídia privada e deixa a futura visibilidade pública como decisão explícita da Fase 04.
- **Cons:** o dono precisa estar autenticado também para reproduzir ou baixar seu próprio vídeo nesta fase.

### Option B: Owner-only upload, but public delivery by URL
- Uploads continuam restritos ao dono, porém qualquer pessoa que conheça o `public_id` recebe streaming e download após o processamento.
- **Pros:** reduz verificações no caminho de leitura.
- **Cons:** antecipa a política de visibilidade pública/unlisted da Fase 04 e transforma um identificador compartilhado em controle de acesso.

### Option C: Channel collaborator roles
- Além do dono, colaboradores administram uploads e mídia conforme permissões armazenadas no canal.
- **Pros:** modela um time de produção desde o início.
- **Cons:** exige uma entidade, contratos e regras de papéis que não pertencem às capabilities da fase.

**Recommendation:** Option A — a relação de propriedade já existe e mantém upload e mídia privados até que a Fase 04 decida visibilidade e colaboração.

**Decision:** A

---

## TD-07: Resumable multipart upload lifecycle contract

**Scope:** Backend

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Serviço de armazenamento de arquivos (vídeos e thumbnails)"

**Context:** TD-02 escolheu multipart pré-assinado, mas ainda faltam as transições e a semântica idempotente que mantêm o registro de vídeo, a sessão multipart e a fila coerentes durante retomada, expiração ou cancelamento.

**Options:**

### Option A: API-owned session on the `DRAFT` video
- `start` valida dono, tipo e `sizeBytes <= 10_000_000_000` (10 GB), cria o vídeo `DRAFT` e persiste a sessão, expiração e referência opaca somente no servidor; URLs curtas são emitidas apenas para as partes solicitadas. `complete` recebe pares ordenados `partNumber`/`etag`, conclui o multipart, confere o tamanho real por `HeadObject`, encerra a sessão e grava uma única outbox; o worker faz depois a transição condicional para `PROCESSING`.
- Repetir `complete` para a mesma sessão devolve o resultado já conhecido sem publicar outro processamento. `cancel` e a rotina de expiração abortam o multipart e removem o rascunho incompleto.
- **Pros:** mantém os bytes fora da API, limita 10 GB no plano de controle e dá um estado recuperável para cada ação.
- **Cons:** o cliente precisa conservar ETags e solicitar novamente URLs expiradas.

### Option B: Ephemeral client multipart session
- A API somente pré-assina operações S3 e o cliente conserva `uploadId`, partes e expiração até concluir.
- **Pros:** reduz colunas de sessão e chamadas de consulta à API.
- **Cons:** cancelamento, limpeza, retomada entre dispositivos e verificação de propriedade não têm uma fonte de verdade no servidor.

### Option C: Storage-event completion
- A API cria o rascunho, mas um evento do bucket informa a conclusão e inicia o processamento.
- **Pros:** reduz uma chamada explícita após o upload.
- **Cons:** MinIO/S3 não fornece o contrato de partes/ETags necessário ao cliente e a autorização/idempotência ficam distribuídas entre API e evento.

**Recommendation:** Option A — a sessão persistida no `DRAFT` sustenta retomada, expiração e conclusão idempotente sem transportar o arquivo pela API.

**Decision:** A

---

## TD-08: FFmpeg and ffprobe worker-processing contract

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo", "Serviço de armazenamento de arquivos (vídeos e thumbnails)"

**Context:** O worker isolado precisa transformar o objeto privado em metadados e thumbnail sem introduzir outro serviço de mídia nem deixar artefatos temporários após sucesso ou falha.

**Options:**

### Option A: Binaries in the worker with a Node process adapter
- A imagem `video-worker` instala `ffmpeg` e `ffprobe`; um adaptador baseado em `node:child_process` baixa o objeto para diretório temporário, usa `ffprobe` em JSON para duração/metadados e FFmpeg para gerar um JPEG, envia a thumbnail ao bucket privado e persiste somente dados normalizados e suas chaves.
- O diretório temporário é removido em `finally`; falhas de processo são re-lançadas para a política de retry. O original completo é preservado no erro terminal para auditoria e futuro reprocessamento.
- **Pros:** mantém FFmpeg fora da API, usa ferramentas nativas e evita uma dependência Node de binding de mídia sem manutenção.
- **Cons:** a imagem do worker fica maior e testes de integração precisam de FFmpeg real.

### Option B: Node wrapper around FFmpeg
- A API/worker usa um wrapper como `fluent-ffmpeg` para montar e executar comandos.
- **Pros:** API JavaScript mais declarativa para alguns comandos.
- **Cons:** ainda requer binários, acrescenta uma abstração sem necessidade e pode atrasar a adoção de flags recentes do FFmpeg.

### Option C: Managed external transcoding service
- Um serviço de mídia remoto recebe o objeto e devolve metadados e thumbnail.
- **Pros:** separa a carga de processamento da infraestrutura própria.
- **Cons:** adiciona fornecedor, credenciais, custo e topologia fora do requisito de worker com FFmpeg/ffprobe desta fase.

**Recommendation:** Option A — o worker com binários explícitos preserva o isolamento já escolhido, oferece diagnósticos diretos e não cria dependência adicional de runtime.

**Decision:** A

---

## TD-09: Durable video-processing event contract

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** A conclusão multipart muda PostgreSQL e precisa publicar no Redis, dois recursos sem transação compartilhada. O contrato da mensagem deve definir quem publica, quando, o payload mínimo e como a entrega ao menos uma vez não corrompe o ciclo de vídeo.

**Options:**

### Option A: Transactional outbox, minimal payload, and `jobId = videoId`
- A conclusão finaliza o multipart e persiste um outbox `video.process` na mesma transação, mantendo o vídeo em `DRAFT` até que o worker o reivindique. Um dispatcher dedicado publica `video.process` na fila BullMQ `video` com `{ version: 1, videoId }`, `jobId = videoId`, três tentativas e backoff exponencial; só então marca o outbox como entregue.
- O `video-worker` é o único consumidor, sempre recarrega o vídeo pelo ID e aplica transições condicionais. Reentregas de outbox ou queue são ignoradas pelo mesmo `jobId`; processamento de `READY`/`ERROR` é no-op e apenas a falha após a última tentativa muda o vídeo para `ERROR`.
- **Pros:** elimina a janela em que o banco registra processamento sem uma intenção recuperável de publicar no Redis e mantém a mensagem pequena e versionável.
- **Cons:** requer tabela e dispatcher de outbox, além do worker.

### Option B: Best-effort publish from the completion request
- Depois de concluir o multipart, a API chama `Queue.add` diretamente e o cliente repete a conclusão se ocorrer falha.
- **Pros:** menos persistência e menos processos internos.
- **Cons:** uma queda entre banco e Redis pode deixar `PROCESSING` sem job caso o cliente não repita a chamada.

### Option C: Rich message as source of truth
- A API publica metadados, chaves e dados do canal no payload e o worker trabalha sem consultar o banco.
- **Pros:** reduz uma leitura por job.
- **Cons:** snapshots ficam obsoletos, aumentam o acoplamento e não substituem a fonte de verdade persistida para idempotência.

**Recommendation:** Option A — o outbox torna a fronteira PostgreSQL–Redis recuperável e o payload mínimo mantém o banco como fonte de verdade.

**Decision:** A

---

## TD-10: Video infrastructure library versions

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Serviço de processamento em segundo plano (filas)", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Reprodução via streaming (sem necessidade de download completo)"

**Context:** A fase introduz integração de fila e S3/MinIO; as versões precisam ser compatíveis com NestJS 11.0.1, TypeScript 5.7 e Node 25.6 do container antes de entrar no plano e no lockfile.

**Options:**

### Option A: Nest BullMQ 11, BullMQ 6, and modular AWS SDK v3
- Instalar `@nestjs/bullmq@^11.0.5`, `bullmq@^6.1.2`, `@aws-sdk/client-s3@^3.1113.0` e `@aws-sdk/s3-request-presigner@^3.1113.0`; usar `node:child_process` e os binários do worker para FFmpeg, sem wrapper adicional.
- **Pros:** o peer range de `@nestjs/bullmq` cobre Nest 11 e BullMQ 6; o SDK v3 cobre MinIO/S3, multipart, URLs pré-assinadas e streams sob Node 25.
- **Cons:** o AWS SDK modular adiciona diversas dependências transitivas e BullMQ 6 exige Redis atualizado.

### Option B: Legacy Nest Bull with Bull 4
- Usar `@nestjs/bull` e `bull` para manter a geração anterior da fila.
- **Pros:** exemplos antigos do ecossistema Nest ainda existem.
- **Cons:** contradiz TD-01, que já escolheu BullMQ, e não oferece a mesma evolução de contratos da versão escolhida.

### Option C: MinIO-specific client and manual BullMQ wiring
- Usar `minio` e instanciar BullMQ manualmente em cada módulo.
- **Pros:** cliente focado no ambiente local e menor dependência de decoradores Nest.
- **Cons:** perde a paridade direta S3 de produção e repete configuração/DI sem vantagem para o escopo.

**Recommendation:** Option A — é a combinação oficialmente documentada, compatível com o runtime instalado e suficiente para o protocolo decidido sem wrappers de mídia.

**Decision:** A
**Libraries:** `@nestjs/bullmq@^11.0.5`, `bullmq@^6.1.2`, `@aws-sdk/client-s3@^3.1113.0`, `@aws-sdk/s3-request-presigner@^3.1113.0`

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue, worker e retries | A — BullMQ + Redis + worker separado | A |
| TD-02 | Backend | Upload direto multipart | A — multipart S3 pré-assinado orquestrado pela API | A |
| TD-03 | Backend | Layout MinIO/S3 e limpeza | A — bucket privado com prefixos por vídeo | A |
| TD-04 | Backend | Estados, falha e idempotência | A — `DRAFT` → `PROCESSING` → `READY`/`ERROR` | A |
| TD-05 | Backend | URL, streaming e download | A — ID opaco + proxy autenticado de Range | A |
| TD-06 | Backend | Propriedade de canal e autorização de mídia privada | A — somente dono via relação com canal | A |
| TD-07 | Backend | Ciclo de vida multipart retomável | A — sessão persistida no `DRAFT` | A |
| TD-08 | Backend | Contrato de processamento FFmpeg/ffprobe | A — binários no worker e `child_process` | A |
| TD-09 | Backend | Contrato durável de evento de processamento | A — outbox + payload mínimo + `jobId = videoId` | A |
| TD-10 | Backend | Bibliotecas de infraestrutura de vídeo | A — Nest BullMQ 11, BullMQ 6 e AWS SDK v3 | A |
