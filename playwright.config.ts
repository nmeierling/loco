import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['LOCO_E2E_PORT'] ?? 4321);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: process.env['CI'] ? 'line' : 'list',
  // The fixture project is tiny, so anything slower than this is a hang, not work.
  // The one genuinely slow spec raises its own budget with test.setTimeout().
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1500, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx ng serve --port ${PORT} --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    // A cold `ng serve` build is well under this; overshooting only delays the report
    // when an AOT error makes the server never come up (see AGENTS.md).
    timeout: 90_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
