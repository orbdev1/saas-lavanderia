import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { fileParallelism: false, testTimeout: 30000, hookTimeout: 60000, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173', DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://laundry:laundry_test@localhost:5433/laundry_test' } } });
