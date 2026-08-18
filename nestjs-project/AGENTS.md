# NestJS subproject instructions

Load `$nestjs-project-conventions` for every change in this directory. Load `$testing-guide-nestjs-project` when planning, implementing, reviewing, or testing behavior. Also load `$nestjs-best-practices` for NestJS architecture and `$typeorm` for database work.

## Environment and hosts

- Run`npm`,`npx`, Node, TypeScript, lint, build, and tests inside`nestjs-api` with `docker compose exec nestjs-api ...`.
- Host probes use `http://localhost:3000` and PostgreSQL at `localhost:5432`.
- Container-to-container connections use Compose service names: PostgreSQL is `db`; Mailpit is `mailpit`.
- Starting the environment means `docker compose up -d`; do not start the persistent NestJS dev server unless the user asks to run the app.
- After startup, verify `docker compose ps` and `docker compose exec db pg_isready -U streamtube`.

## Architecture and tests

- Keep controllers focused on HTTP, services on business rules, and each domain in its own module.
- `*.spec.ts` is unit, `*.integration-spec.ts` uses real infrastructure and runs serially, and `test/*.e2e-spec.ts` exercises HTTP with Supertest.
- Shared-database integration and e2e runs must use `--runInBand` where the script does not already enforce it.
- Runtime assets such as Handlebars templates must be declared in`nest-cli.json`.

## Completion gates

Run the relevant tests, then as applicable:

```text
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e
docker compose exec nestjs-api npx tsc --noEmit
docker compose exec nestjs-api npm run lint
docker compose exec nestjs-api npm run build
```

`npm run lint` fixes files. Review the diff afterward and reject unrelated automatic changes.
