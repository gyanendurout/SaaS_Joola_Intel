import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  // Every page is behind the login; sign the QA account in once (no email sent).
  globalSetup: './qa/playwright-global-setup.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'qa/playwright-report', open: 'never' }],
  ],
  outputDir: 'qa/test-results',
  use: {
    baseURL: BASE_URL,
    storageState: 'qa/.auth/state.json',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
