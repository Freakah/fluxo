import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build in demo mode with a throwaway data directory.
// Run `npm run build` first (CI does this).
const PORT = 3100;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', contextOptions: { reducedMotion: 'reduce' } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }, testIgnore: /screenshots/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /screenshots/ },
    { name: 'screenshots', use: { ...devices['Desktop Chrome'] }, testMatch: /screenshots/ },
  ],
  webServer: {
    command: 'node server/index.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { APP_MODE: 'demo', PORT: String(PORT), PUBLIC_URL: `http://localhost:${PORT}`, DATA_DIR: 'test-results/e2e-data', NODE_ENV: 'production', DATA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', LOG_LEVEL: 'warn' },
  },
});
