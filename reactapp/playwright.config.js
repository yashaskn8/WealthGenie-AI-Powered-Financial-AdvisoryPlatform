import { defineConfig, devices } from '@playwright/test';
import { env } from 'node:process';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/*.spec.js', '**/*.spec.ts'],
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

