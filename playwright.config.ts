import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 60000,
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm --filter @lav/server test:e2e-server', url: 'http://localhost:3001/api/health', env: { DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://laundry:laundry_test@localhost:5433/laundry_test', NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', GO_LISTEN_ADDR: '127.0.0.1:3001', MFA_KEY: '07'.repeat(32) }, reuseExistingServer: false, timeout: 120000 },
    { command: 'pnpm --filter @lav/web exec vite --port 5174 --strictPort', url: 'http://localhost:5174', env: { API_TARGET: 'http://localhost:3001' }, reuseExistingServer: false },
  ],
});
