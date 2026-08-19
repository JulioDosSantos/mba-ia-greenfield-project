import { test as base, expect } from "@playwright/test";

type NetworkFixtures = {
  network: void;
};

// The isolated upstream fixture runs beside the containerized Next.js dev
// server. This fixture is auto-applied to every E2E test to document that
// contract. Rules:
//   - Do NOT page.route() /api/** — it short-circuits real Route Handlers.
//   - Do NOT reach the real NestJS API — the upstream HTTP service is a fixture.
//   - Per-scenario outcomes use reserved trigger values in the fixture
//     (e.g. "conflict@example.com" → 409); no per-test server.use() here.
export const test = base.extend<NetworkFixtures>({
  network: [async ({}, use) => { await use(); }, { auto: true }],
});

export { expect };
