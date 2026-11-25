import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool, db, sql, one } from '../src/db.js';
import { migrate } from '../src/migrate.js';

let app: FastifyInstance;
interface Account { cookie: string; company: string; user: string }
let a: Account; let b: Account; let customer: string; let service: string; let order: string;
const origin = 'http://localhost:5173';
function call(account: Account, method: HTTPMethods, url: string, payload?: object) { return app.inject({ method, url: `/api${url}`, headers: { origin, cookie: account.cookie, 'x-company-id': account.company }, payload }); }
async function register(suffix: string): Promise<Account> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { origin }, payload: { email: `${suffix}-${crypto.randomUUID()}@example.test`, password: 'Password-test-123!', name: suffix, company: `Lavandería ${suffix}` } });
  expect(response.statusCode, response.body).toBe(201);
  const cookie = response.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  return { cookie, company: me.json().memberships[0].companyId, user: me.json().id };
}
async function newOrder(account = a, items = [{ serviceId: service, quantity: 2 }]) {
  const response = await call(account, 'POST', '/orders', { customerId: customer, dueAt: new Date(Date.now() + 86400000).toISOString(), items, requestId: crypto.randomUUID() });
  expect(response.statusCode, response.body).toBe(201); return response.json().id as string;
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.endsWith('_test')) throw new Error('Integration tests require a database ending in _test');
  await migrate(); app = await buildApp(); a = await register('Alpha'); b = await register('Beta');
  const c = await call(a, 'POST', '/customers', { name: 'Cliente Alpha', phone: '51999999999' }); customer = c.json().id;
  const services = await call(a, 'GET', '/services'); service = services.json().find((s: { unit: string }) => s.unit === 'kg').id;
});
afterAll(async () => { await app?.close(); await pool.end(); });
describe('aislamiento y flujo financiero con PostgreSQL real', () => {
  it('limita tiempo de consultas y esperas de bloqueo en las conexiones de API', async () => {
    expect(await one(db, sql`SHOW statement_timeout`)).toEqual({ statement_timeout: '15s' });
    expect(await one(db, sql`SHOW lock_timeout`)).toEqual({ lock_timeout: '5s' });
  });
  it('bloquea escrituras de otro origen y acceso anónimo', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject('/api/customers')).statusCode).toBe(401);
  });
  it('no acepta una empresa arbitraria ni privilegios de plataforma', async () => {
    expect((await call({ ...a, company: b.company }, 'GET', '/customers')).statusCode).toBe(403);
    expect((await call(a, 'GET', '/platform/companies')).statusCode).toBe(403);
    expect((await call(b, 'GET', '/customers')).json()).toEqual([]);
  });
  it('impide relaciones cruzadas incluso directamente en SQL', async () => {
    expect((await call(b, 'POST', '/orders', { customerId: customer, dueAt: new Date().toISOString(), items: [{ serviceId: service, quantity: 2 }], requestId: crypto.randomUUID() })).statusCode).toBe(404);
    await expect(db.execute(sql`INSERT INTO order_items(company_id,order_id,service_id,name,unit,actual,charged,price,total) VALUES (${b.company},${crypto.randomUUID()},${service},'x','kg',1,1,100,100)`)).rejects.toThrow();
  });
  it('busca clientes por nombre o celular dentro de la empresa y escapa comodines', async () => {
    expect((await call(a, 'GET', '/customers?search=alpha')).json().map((c: { id: string }) => c.id)).toEqual([customer]);
    expect((await call(a, 'GET', '/customers?search=999999999')).json().map((c: { id: string }) => c.id)).toEqual([customer]);
    expect((await call(b, 'GET', '/customers?search=alpha')).json()).toEqual([]);
    expect((await call(a, 'GET', '/customers?search=%25')).json()).toEqual([]);
    expect((await call(a, 'GET', '/customers?search=_')).json()).toEqual([]);
    expect((await call(a, 'GET', `/customers?search=${'a'.repeat(121)}`)).statusCode).toBe(400);
  });
  it('agrupa un servicio y aplica el mínimo una sola vez; conserva precios', async () => {
    order = await newOrder(a, [{ serviceId: service, quantity: 1 }, { serviceId: service, quantity: 1 }]);
    const detail = (await call(a, 'GET', `/orders/${order}`)).json();
    expect(detail.total).toBe(1800); expect(detail.items).toHaveLength(1); expect(Number(detail.items[0].actual)).toBe(2); expect(Number(detail.items[0].charged)).toBe(3);
    expect((await call(b, 'GET', `/orders/${order}`)).statusCode).toBe(404);
    expect((await call(b, 'POST', `/orders/${order}/payments`, { amount: 100, method: 'yape', requestId: crypto.randomUUID() })).statusCode).toBe(404);
    await call(a, 'PUT', `/services/${service}`, { name: 'Lavado actualizado', unit: 'kg', price: 900, minimum: 3 });
    expect((await call(a, 'GET', `/orders/${order}`)).json().total).toBe(1800);
  });
  it('usa UUIDv7 en registros nuevos y admite relaciones con UUIDv4 existentes', async () => {
    expect(a.user[14]).toBe('7');
    expect(customer[14]).toBe('7');
    const legacyId = crypto.randomUUID();
    await db.execute(sql`INSERT INTO customers(id,company_id,name) VALUES (${legacyId},${a.company},'Cliente anterior UUIDv4')`);
    const result = await call(a, 'POST', '/orders', { customerId: legacyId, dueAt: new Date().toISOString(), items: [{ serviceId: service, quantity: 2.45 }], requestId: crypto.randomUUID() });
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json().id[14]).toBe('7');
    expect((await call(a, 'GET', `/orders/${result.json().id}`)).json().customerId).toBe(legacyId);
  });
  it('acepta piezas enteras y rechaza fracciones y kilos de tres decimales', async () => {
    const services = (await call(a, 'GET', '/services')).json();
    const piece = services.find((s: { unit: string }) => s.unit === 'piece');
    const input = { customerId: customer, dueAt: new Date().toISOString(), items: [{ serviceId: piece.id, quantity: 1 }], requestId: crypto.randomUUID() };
    expect((await call(a, 'POST', '/orders', input)).statusCode).toBe(201);
    expect((await call(a, 'POST', '/orders', { ...input, requestId: crypto.randomUUID(), items: [{ serviceId: piece.id, quantity: 1.5 }] })).statusCode).toBe(400);
    expect((await call(a, 'POST', '/orders', { ...input, requestId: crypto.randomUUID(), items: [{ serviceId: service, quantity: 2.451 }] })).statusCode).toBe(400);
  });
  it('exporta solo clientes de la empresa autorizada y registra auditoría', async () => {
    const exported = await call(a, 'GET', '/customers/export');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain('Cliente Alpha');
    expect(exported.body).not.toContain('password');
    expect((await call(b, 'GET', '/customers/export')).body).not.toContain('Cliente Alpha');
    expect((await call({ ...a, company: b.company }, 'GET', '/customers/export')).statusCode).toBe(403);
    expect(await one(db, sql`SELECT id FROM audit WHERE company_id=${a.company} AND actor_id=${a.user} AND action='customers.exported'`)).toBeDefined();
  });
  it('los reintentos concurrentes no duplican órdenes ni pagos', async () => {
    const input = { customerId: customer, dueAt: new Date().toISOString(), items: [{ serviceId: service, quantity: 2 }], requestId: crypto.randomUUID() };
    const created = await Promise.all([call(a, 'POST', '/orders', input), call(a, 'POST', '/orders', input)]);
    expect(created[0].statusCode).toBe(201); expect(created[0].json().id).toBe(created[1].json().id);
    const payment = { amount: 600, method: 'yape', requestId: crypto.randomUUID() };
    const results = await Promise.all([call(a, 'POST', `/orders/${order}/payments`, payment), call(a, 'POST', `/orders/${order}/payments`, payment)]);
    expect(results[0].statusCode).toBe(200); expect(results[0].json().id).toBe(results[1].json().id);
    expect((await call(a, 'GET', `/orders/${order}`)).json().paid).toBe(600);
    expect((await call(a, 'POST', `/orders/${order}/payments`, { ...payment, amount: 700 })).statusCode).toBe(409);
  });
  it('impide sobrepago concurrente y entrega con deuda', async () => {
    const results = await Promise.all([1, 2].map(() => call(a, 'POST', `/orders/${order}/payments`, { amount: 1000, method: 'plin', requestId: crypto.randomUUID() })));
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await call(a, 'PATCH', `/orders/${order}/status`, { status: 'delivered' })).statusCode).toBe(409);
    expect((await call(a, 'PATCH', `/orders/${order}/status`, { status: 'processing' })).statusCode).toBe(200);
    expect((await call(a, 'PATCH', `/orders/${order}/status`, { status: 'ready' })).statusCode).toBe(200);
    expect((await call(a, 'PATCH', `/orders/${order}/status`, { status: 'delivered' })).statusCode).toBe(409);
    await call(a, 'POST', `/orders/${order}/payments`, { amount: 200, method: 'card', requestId: crypto.randomUUID() });
    expect((await call(a, 'PATCH', `/orders/${order}/status`, { status: 'delivered' })).statusCode).toBe(200);
    expect((await call(a, 'POST', `/orders/${order}/refunds`, { amount: 100, method: 'card', reason: 'Devolución tardía', requestId: crypto.randomUUID() })).statusCode).toBe(409);
  });
  it('caja, devolución y anulación mantienen saldos coherentes', async () => {
    const id = await newOrder();
    const payment = { amount: 500, method: 'cash', requestId: crypto.randomUUID() };
    expect((await call(a, 'POST', `/orders/${id}/payments`, payment)).statusCode).toBe(409);
    const opened = await call(a, 'POST', '/cash/open', { opening: 1000 }); expect(opened.statusCode).toBe(200);
    expect((await call(a, 'POST', `/orders/${id}/payments`, payment)).statusCode).toBe(200);
    expect((await call(a, 'POST', `/orders/${id}/cancel`, { reason: 'Cliente cancela' })).statusCode).toBe(409);
    expect((await call(a, 'POST', `/orders/${id}/refunds`, { amount: 501, method: 'cash', reason: 'Cliente cancela', requestId: crypto.randomUUID() })).statusCode).toBe(409);
    expect((await call(a, 'POST', `/orders/${id}/refunds`, { amount: 500, method: 'cash', reason: 'Cliente cancela', requestId: crypto.randomUUID() })).statusCode).toBe(200);
    expect((await call(a, 'POST', `/orders/${id}/cancel`, { reason: 'Cliente cancela' })).statusCode).toBe(200);
    const closed = await call(a, 'POST', `/cash/${opened.json().id}/close`, { counted: 1000 }); expect(closed.json()).toEqual({ counted: 1000, expected: 1000 });
  });
  it('respeta rol de mostrador y revocación de membresía', async () => {
    await db.execute(sql`INSERT INTO memberships(company_id,user_id,role) VALUES (${a.company},${b.user},'staff')`);
    const staff = { ...b, company: a.company };
    expect((await call(staff, 'GET', '/orders')).statusCode).toBe(200);
    expect((await call(staff, 'POST', '/services', { name: 'No permitido', unit: 'kg', price: 100, minimum: 0 })).statusCode).toBe(403);
    expect((await call(staff, 'GET', '/audit')).statusCode).toBe(403);
    expect((await call(staff, 'GET', '/customers/export')).statusCode).toBe(403);
    expect((await call(staff, 'GET', '/reports/export')).statusCode).toBe(403);
    expect((await call(a, 'DELETE', `/team/${b.user}`)).statusCode).toBe(200);
    expect((await call(staff, 'GET', '/orders')).statusCode).toBe(403);
  });
  it('permite métricas globales solo al superadmin y audita el acceso', async () => {
    await db.execute(sql`UPDATE users SET platform_admin=true WHERE id=${a.user}`);
    const metrics = await call(a, 'GET', '/platform/companies'); expect(metrics.statusCode).toBe(200); expect(metrics.json().some((c: { id: string }) => c.id === b.company)).toBe(true);
    expect((await call(b, 'GET', `/platform/companies/${a.company}`)).statusCode).toBe(403);
    const detail = await call(a, 'GET', `/platform/companies/${a.company}`); expect(detail.json().balances.some((c: { id: string }) => c.id === customer)).toBe(true);
    expect(await one(db, sql`SELECT id FROM audit WHERE actor_id=${a.user} AND action='platform.metrics.viewed'`)).toBeDefined();
    await call(a, 'PATCH', `/platform/companies/${b.company}`, { status: 'suspended', subscriptionDue: 5000, reason: 'Suscripción vencida' });
    expect((await call(b, 'GET', '/orders')).statusCode).toBe(403);
  });
  it('invitación de un uso crea acceso al tenant correcto', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const email = `invite-${crypto.randomUUID()}@example.test`;
      expect((await call(a, 'POST', '/team/invite', { email, role: 'staff' })).statusCode).toBe(200);
      const value = String(log.mock.calls[0][0]).match(/invite=([a-f0-9]{64})/)![1];
      const payload = { token: value, email, name: 'Invitado', password: 'Invitado-seguro-123!' };
      const accepted = await app.inject({ method: 'POST', url: '/api/auth/accept', headers: { origin }, payload });
      expect(accepted.statusCode, accepted.body).toBe(200);
      const cookie = accepted.cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
      expect(me.memberships[0]).toMatchObject({ companyId: a.company, role: 'staff' });
      expect((await app.inject({ method: 'POST', url: '/api/auth/accept', headers: { origin }, payload })).statusCode).toBe(400);
    } finally { log.mockRestore(); }
  });
  it('recuperación de un uso revoca sesiones y no revela token en HTTP', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const user = (await one<{ email: string }>(db, sql`SELECT email FROM users WHERE id=${b.user}`))!;
      const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot', headers: { origin }, payload: { email: user.email } });
      expect(forgot.json()).toEqual({ ok: true });
      const value = String(log.mock.calls[0][0]).match(/reset=([a-f0-9]{64})/)![1];
      const payload = { token: value, password: 'Nueva-segura-456!' };
      expect((await app.inject({ method: 'POST', url: '/api/auth/reset', headers: { origin }, payload })).statusCode).toBe(200);
      expect((await call(b, 'GET', '/auth/me')).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/auth/reset', headers: { origin }, payload })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { email: user.email, password: payload.password } })).statusCode).toBe(200);
    } finally { log.mockRestore(); }
  });
  it('revoca sesión al salir', async () => {
    expect((await call(a, 'POST', '/auth/logout')).statusCode).toBe(200);
    expect((await call(a, 'GET', '/auth/me')).statusCode).toBe(401);
  });
});
