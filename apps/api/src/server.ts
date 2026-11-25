import { buildApp } from './app.js';
import { pool } from './db.js';
if (!process.env.DATABASE_URL || !process.env.APP_ORIGIN) throw new Error('Configura DATABASE_URL y APP_ORIGIN');
if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN.startsWith('https://')) throw new Error('Producción requiere HTTPS');
const app = await buildApp();
await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
