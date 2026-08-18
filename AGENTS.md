# StreamTube agent instructions

## Session entry point

- Open Codex at this Git root, not from its parent directory, and mark the project as trusted so project configuration, skills, agents, and MCP servers can load.
- Read the instruction file closest to the files being changed. Work under`nestjs-project/` also uses`nestjs-project/AGENTS.md`; work under`next-frontend/` also uses`next-frontend/AGENTS.md`.
- Preserve historical planning artifacts. New planning artifacts use the workflows and paths under `.agents/`.

## Project

StreamTube is a video-sharing monorepo. Implemented areas are a NestJS 11 backend and a Next.js 16 frontend. Authentication is delivered; video processing, object storage, and queues remain planned work.

-`nestjs-project/`: NestJS API, PostgreSQL, Mailpit, Jest, and TypeORM.
-`next-frontend/`: Next.js App Router BFF, React 19, Tailwind CSS v4, Vitest, MSW, and Playwright.
- `docs/`: project plan, decisions, phase/task plans, inventories, and diagrams.

## Skill selection

Before acting, decompose the request and load every matching skill from `.agents/skills/`. Skills marked explicit-only must be invoked by `$name`; do not infer them from ambient wording. For subproject changes, always load its conventions skill and its testing guide when tests or implementation are involved.

The public planning pipeline is:

`$research` -> `$plan-context` -> `$plan-validate` <-> `$plan-resolve` -> `$plan-build` -> optional `$plan-test-specs` -> `$implement`

`$plan-phase` is an alias for `$plan-pipeline`; `$implement-phase` is an alias for `$implement` in phase mode.

## Documentation and MCP gates

- For a task that depends on a library API, first inspect the installed version and use `context7` for matching documentation. If `context7` is unavailable, stop that library-dependent task with a clear diagnostic; it is not a startup requirement for unrelated work.
- `postgres` is optional and connects from the host through `localhost:5432`. Writes require approval. Inside Compose containers, use service names such as `db`, never host loopback, to reach sibling services.
- `figma` is optional and disabled by default. Figma work must load `$figma-use`; if the server is disabled or unreachable, stop before inventing design data.

## Delegation

Use the six project readers when their bounded output matches the task: `plan_reader`, `decisions_reader`, `decisions_detail_reader`, `decisions_correlator`, `phases_reader`, and `inventory_digest_reader`. They are read-only. Dispatch independent work in waves of at most three agents, then consolidate results before a later wave.

## User-decision pause protocol

When a workflow needs user input:

1. Finish safe discovery that does not depend on the decision.
2. Record the goal, current stage, relevant files, completed checks, and pending mutations.
3. Ask at most three independent decisions in one turn, with stable IDs, concise options, and a recommended default where appropriate.
4. Make no answer-dependent writes while paused.
5. On reply, re-read affected state, verify the checkpoint is still current, apply each answer once, and resume from the recorded stage without repeating completed writes.

## Engineering boundaries

- Keep changes within the requested feature or migration. Preserve unrelated dirty-worktree changes.
- Prefer `rg` and `rg --files`, targeted reads, and `apply_patch`.
- Run relevant tests during development and the documented subproject gates before completion when the environment supports them.
- Do not implement Phase 03 HTTP APIs, entities, migrations, or product features as part of agent-foundation work.
