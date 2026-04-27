import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'PATH=/opt/homebrew/bin:$PATH npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    env: {
      REPOCAT_USE_FIXTURE_GITHUB: '1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
