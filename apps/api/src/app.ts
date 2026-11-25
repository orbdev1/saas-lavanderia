import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { authRoutes } from './auth.js';
import { operationRoutes } from './operations.js';
import { orderAdditionRoutes } from './order-additions.js';
import { reportRoutes } from './reports.js';
import { HttpError } from './security.js';
import { db, sql } from './db.js';

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 128 * 1024, trustProxy: process.env.NODE_ENV === 'production' ? (_address, hop) => hop < 1 : false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== process.env.APP_ORIGIN) throw new HttpError(403, 'Origen no permitido');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ message: error.message });
    const e = error as { code?: string; statusCode?: number; cause?: { code?: string } };
    const code = e.code ?? e.cause?.code;
    if (code === '23505') return reply.code(409).send({ message: 'El registro ya existe' });
    if (code === '23503') return reply.code(400).send({ message: 'Relación de datos inválida' });
    if (code === '57014' || code === '55P03') return reply.code(503).send({ message: 'La operación tardó demasiado. Reintenta en unos momentos.' });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ message: e.statusCode === 429 ? 'Demasiados intentos; espera un momento' : 'Solicitud inválida' });
    request.log.error(error); return reply.code(500).send({ message: 'Error interno. Intenta nuevamente.' });
  });
  app.get('/api/health', async () => { await db.execute(sql`SELECT 1`); return { status: 'ok' }; });
  await authRoutes(app); await operationRoutes(app); await orderAdditionRoutes(app); await reportRoutes(app);
  return app;
}
