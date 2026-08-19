import { defineConfig, devices } from "@playwright/test";

// The dev server and its isolated upstream fixture run inside Docker.
// Playwright runs on the HOST — never add a webServer block here.
// Start it with: docker compose exec -d next-frontend npm run dev:e2e
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e-spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
