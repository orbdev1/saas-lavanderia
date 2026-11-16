import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { db, one, sql, type Executor } from './db.js';
import { id, type Role } from '@lav/shared';

export class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
export function assert(value: unknown, status: number, message: string): asserts value { if (!value) throw new HttpError(status, message); }
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export interface Actor { id: string; name: string; email: string; platformAdmin: boolean }
export async function authenticate(request: FastifyRequest): Promise<Actor> {
  const session = request.cookies.session;
  assert(session, 401, 'Inicia sesión para continuar');
  const user = await one<Actor>(db, sql`SELECT u.id,u.name,u.email,u.platform_admin AS "platformAdmin" FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=${hash(session)} AND s.expires_at>now()`);
  assert(user, 401, 'Tu sesión ha vencido');
  return user;
}
export async function tenant(request: FastifyRequest, allowed: Role[] = ['owner', 'manager', 'staff']) {
  const actor = await authenticate(request);
  const companyId = request.headers['x-company-id'];
  assert(typeof companyId === 'string' && id.safeParse(companyId).success, 400, 'Selecciona una empresa válida');
  const membership = await one<{ role: Role; status: string; branchId: string }>(db, sql`SELECT m.role,c.status,b.id AS "branchId" FROM memberships m JOIN companies c ON c.id=m.company_id JOIN branches b ON b.company_id=c.id WHERE m.user_id=${actor.id} AND m.company_id=${companyId} ORDER BY b.id LIMIT 1`);
  assert(membership, 403, 'No tienes acceso a esta empresa');
  assert(membership.status === 'active', 403, 'La suscripción está suspendida; contacta al administrador');
  assert(allowed.includes(membership.role), 403, 'Tu rol no permite esta acción');
  return { actor, companyId, ...membership };
}
export async function platform(request: FastifyRequest) { const actor = await authenticate(request); assert(actor.platformAdmin, 403, 'Acceso exclusivo de plataforma'); return actor; }
export async function audit(executor: Executor, actorId: string, companyId: string | null, action: string, entityId: string | null, detail: unknown = {}) {
  await executor.execute(sql`INSERT INTO audit(actor_id,company_id,action,entity_id,detail) VALUES (${actorId},${companyId},${action},${entityId},${JSON.stringify(detail)}::jsonb)`);
}
export async function sendLink(email: string, subject: string, path: string) {
  const url = `${process.env.APP_ORIGIN}${path}`;
  if (process.env.NODE_ENV !== 'production' && !process.env.MAIL_API_KEY) { console.info(`[correo local] ${email} — ${subject}: ${url}`); return; }
  assert(process.env.MAIL_API_KEY, 503, 'Correo no configurado');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.MAIL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: email, subject, text: `${subject}\n\n${url}\n\nSi no solicitaste este mensaje, ignóralo.` }) });
  assert(response.ok, 503, 'No se pudo enviar el correo');
}
