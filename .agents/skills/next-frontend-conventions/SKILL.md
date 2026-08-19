---
name: next-frontend-conventions
description: "Project-specific Next.js BFF, UI, MSW, testing, and code-quality conventions selected by affected path."
---

# Next.js frontend conventions

Use this skill for any work under`next-frontend/`.

1. Read`next-frontend/AGENTS.md`.
2. Match every affected path against the routing table.
3. Read only matching files from `references/`; multiple references may apply.
4. Apply the documented BFF, token, and test boundaries without inventing missing infrastructure.

## Reference routing

- All TypeScript and TSX:`next-frontend-code-quality.md`.
- `app/api/**/*.ts` and server API helpers:`next-frontend-bff-api.md`.
- `mocks/**/*.ts` and tests using MSW:`next-frontend-msw-mocks.md`.
- Test files and `tests/**`:`next-frontend-testing.md`.
- `app/**/*.tsx`, `app/**/*.css`, and `components/**/*.tsx`:`next-frontend-ui.md`.

Use `rg --files .agents/skills/next-frontend-conventions/references` to resolve exact filenames.
