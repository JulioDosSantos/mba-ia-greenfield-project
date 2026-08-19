# Next.js subproject instructions

Load `$next-frontend-conventions` for every change in this directory. Load `$testing-guide-next-frontend` when planning, implementing, reviewing, or testing behavior. Use `$next-best-practices` and `$vercel-react-best-practices` for framework and performance decisions. Figma-driven work also requires `$figma-use` and `$figma-implement-design`.

Next.js 16 may differ from training data. Before changing framework behavior, inspect the installed documentation under `node_modules/next/dist/docs/` and use Context7 when a library API is involved.

## Environment and hosts

- Run `npm`, `npx`, Node, TypeScript, shadcn, lint, build, and Vitest inside `next-frontend` with `docker compose exec next-frontend ...`.
- Playwright and connectivity probes run on the host against `http://localhost:3001`. Host Playwright dependencies are independent from the container dependencies.
- The Compose service owns `/home/node/app/node_modules` through a nested volume; never let container installation overwrite host Playwright binaries or shims.
- From the frontend container, reach the separate backend stack through the configured `API_URL` host; do not replace it with container loopback.
- Starting the environment means starting only the container. Start the persistent dev server only when the user asks to run the app.

## Architecture and tests

- Use Server Components by default. Add `use client` only for state, effects, refs, browser APIs, or interactive handlers.
- The browser calls same-origin Route Handlers under `app/api/**`; only server code knows `env.API_URL`.
- Wire shapes derive from `lib/api/types.gen.ts`; do not hand-copy backend DTOs.
- `*.test.ts(x)` is unit, `*.integration.test.ts(x)` is Vitest plus server-side MSW, and `tests/*.e2e-spec.ts` is Playwright.
- Do not browser-intercept `/api/**` in e2e tests. Start `npm run dev:e2e` inside the container: the real Route Handlers run under Webpack and call the isolated local HTTP upstream fixture. MSW remains the upstream fake for Vitest integration tests.
- Tokens live in `app/globals.css`; components consume tokens rather than hardcoded design values. Custom SVG icons live in `components/icons/`.

## Completion gates

Run the relevant tests, then as applicable:

```text
docker compose exec next-frontend npm test
docker compose exec next-frontend npx tsc --noEmit
docker compose exec next-frontend npm run lint
docker compose exec next-frontend npm run build
docker compose exec next-frontend npm run dev:e2e -- --hostname 0.0.0.0
node node_modules/@playwright/test/cli.js test
```

Review the diff after any command that can rewrite files.
