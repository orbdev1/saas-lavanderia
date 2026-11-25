import { spawnSync } from 'node:child_process';
const database = process.env.GO_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgres://laundry:laundry_test@localhost:5433/laundry_test';
if (!new URL(database).pathname.endsWith('_test')) throw new Error('Las pruebas Go requieren base _test');
const result = spawnSync('go', ['test', './...'], {
  cwd: new URL('../apps/server/', import.meta.url), stdio: 'inherit',
  env: { ...process.env, GO_TEST_DATABASE_URL: database },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
