---
name: nestjs-project-conventions
description: "Project-specific NestJS, TypeORM, auth, strict TypeScript, and test conventions selected by affected path."
---

# NestJS project conventions

Use this skill for any work under`nestjs-project/`.

1. Read`nestjs-project/AGENTS.md`.
2. Match every affected path against the reference routing table below.
3. Read only the matching files from `references/`; multiple references may apply.
4. Treat the references as project rules. When code and a reference disagree, report the drift instead of silently weakening the rule.

## Reference routing

- All `src/**/*.ts` and `test/**/*.ts`: `typescript-strict.md`,`nestjs-common-conventions.md`.
- `src/auth/**/*.ts`: `auth-jwt.md`.
- Controllers:`nestjs-controllers.md`.
- DTOs:`nestjs-dtos.md`.
- Entities:`nestjs-entities.md`.
- Modules:`nestjs-modules.md`.
- Services and repositories:`nestjs-services.md`,`nestjs-layer-separation.md`, `typeorm-queries.md` when persistence is involved.
- Tests and test helpers:`nestjs-testing.md`.
- Migrations and data sources: `typeorm-migrations.md`.

Use `rg --files .agents/skills/nestjs-project-conventions/references` to resolve exact filenames.
