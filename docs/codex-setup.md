# Configuração do Codex

Esta fundação é local ao repositório e versionada. Ela não importa ou reescreve os artefatos históricos do projeto.

## Abrir o projeto

1. Abra o Codex em `mba-ia-greenfield-project/`, que é a raiz Git real.
2. Marque o projeto como confiável. A configuração local só é carregada para projetos confiáveis.
3. Inicie uma sessão nova após alterar configuração, skills ou agentes para refazer a descoberta.

O Codex monta as instruções da raiz até o diretório atual. Na raiz, carrega `AGENTS.md`; em`nestjs-project/` ou`next-frontend/`, acrescenta o respectivo arquivo aninhado. O limite padrão da cadeia é 32 KiB.

## Estrutura

- `AGENTS.md`: fatos compartilhados, roteamento de skills, gates MCP e protocolo de pausa.
- `.agents/skills/<nome>/SKILL.md`: 27 skills locais. Metadados opcionais ficam em `agents/openai.yaml` dentro da skill.
- `.codex/agents/*.toml`: seis leitores públicos e read-only.
- `.codex/config.toml`: concorrência de agentes e servidores MCP.

Skills explicit-only são chamadas com `$nome`. Exemplos: `$research`, `$plan-context auth-frontend` e `$implement phase-03-upload`. As demais podem ser selecionadas pelo Codex quando a descrição corresponder à tarefa.

## Pipeline público

```text
$research
  -> $plan-context
  -> $plan-validate
  <-> $plan-resolve
  -> $plan-build
  -> $plan-test-specs  (opcional)
  -> $implement
```

`$plan-phase` encaminha para `$plan-pipeline`. `$implement-phase` encaminha para `$implement` em modo phase. Os aliases não possuem procedimentos divergentes.

## Leitores especializados

Os agentes `plan_reader`, `decisions_reader`, `decisions_detail_reader`, `decisions_correlator`, `phases_reader` e `inventory_digest_reader` só leem. O limite da sessão é de três subagentes simultâneos; tarefas maiores devem ser despachadas em ondas.

## MCPs

### Context7

`context7` usa o endpoint HTTP oficial `https://mcp.context7.com/mcp` e fica habilitado, com timeout ampliado. Ele é gate apenas quando a tarefa depende de uma API de biblioteca: confira a versão instalada, consulte documentação compatível e pare com diagnóstico claro se o servidor não estiver disponível. Tarefas sem dependência de biblioteca não devem falhar por isso. Uma chave de API é opcional para o acesso anônimo; configure autenticação apenas quando precisar de limites maiores.

### PostgreSQL

`postgres` é opcional e acessa a porta publicada do host em `localhost:5432`, banco e credenciais locais `streamtube`. Ferramentas de escrita pedem aprovação. O container da aplicação continua usando o host Compose `db`; os dois contextos de rede não são intercambiáveis.

Com a stack backend ativa, valide uma leitura simples com `SELECT 1`.

### Figma

`figma` aponta para `http://127.0.0.1:3845/mcp` e fica desabilitado por padrão. Para tarefas Figma:

1. inicie o servidor MCP local do Figma;
2. defina `mcp_servers.figma.enabled = true` na configuração local do projeto;
3. reinicie a sessão;
4. use `$figma-use` antes de ler ou implementar o design.

Enquanto estiver desabilitado, a tarefa deve parar com uma mensagem acionável, sem inventar nodes, screenshots ou assets.

## Validação da instalação

Na raiz Git, execute:

```powershell
codex mcp list
codex debug prompt-input
codex doctor --json
```

Repita `codex debug prompt-input` a partir de`nestjs-project/` e`next-frontend/` para conferir a cadeia efetiva. O CLI 0.147.0 rejeita `--strict-config` nos subcomandos `mcp` e `debug`; para essa versão, valide também o TOML com um parser e use `codex doctor --json`. Se uma versão futura aceitar o modo estrito nesses subcomandos, prefira-o. Em uma sessão nova, confirme as 27 skills no disco, as 11 implicitamente descobertas no catálogo e as 16 explicit-only por invocação `$nome`; teste cada MCP apenas quando sua dependência local estiver ativa.

## Troubleshooting

- Skills ou agentes ausentes: confirme a raiz Git, a confiança do projeto e reinicie a sessão.
- Configuração rejeitada: no CLI 0.147.0, use `codex doctor --json` e valide `.codex/config.toml` com um parser TOML; `--strict-config` não é aceito por `mcp` ou `debug` nessa versão.
- Context7 indisponível: confirme acesso HTTPS a `https://mcp.context7.com/mcp` e, se usar autenticação, a chave configurada; não prossiga com uma decisão de API de biblioteca sem documentação.
- PostgreSQL indisponível: suba`nestjs-project/compose.yaml`, confirme a publicação de `5432` e teste `docker compose exec db pg_isready -U streamtube` dentro do subprojeto.
- Figma indisponível: confirme o servidor local na porta `3845`, habilite a entrada e reinicie a sessão.
- Instruções aninhadas ausentes: rode o diagnóstico de prompt no diretório do subprojeto, pois a descoberta ocorre da raiz até o diretório atual.
