import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/server.ts', 'src/migrate.ts', 'src/admin.ts'], format: ['esm'], platform: 'node', target: 'node26', noExternal: ['@lav/shared'], clean: true });
