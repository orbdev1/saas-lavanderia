import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import type { OrderDetail, OrderAdditionInput } from '@lav/shared';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { db, pool, sql, one } from '../src/db.js';

interface Account { cookie: string; company: string; user: string }
let app: FastifyInstance;
let owner: Account;
let other: Account;
let staff: Account;
let customer: string;
let kg: string;
let piece: string;
let foreignService: string;
const origin = 'http://localhost:5173';

function call(account: Account, method: HTTPMethods, path: string, payload?: object) {
  return app.inject({ method, url: `/api${path}`, headers: { origin, cookie: account.cookie, 'x-company-id': account.company }, payload });
}
async function register(name: string): Promise<Account> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { origin },
    payload: { email: `${crypto.randomUUID()}@example.test`, name, company: name, password: 'Prueba-adicional-123!' } });
  expect(response.statusCode).toBe(201);
  const cookie = response.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
  return { cookie, user: me.id, company: me.memberships[0].companyId };
}
async function create(serviceId = kg) {
  const response = await call(owner, 'POST', '/orders', {
    customerId: customer, dueAt: '2026-12-01T17:00:00.000Z', items: [{ serviceId, quantity: 2 }], requestId: crypto.randomUUID(),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}
async function detail(id: string): Promise<OrderDetail> { return (await call(owner, 'GET', `/orders/${id}`)).json(); }
async function input(id: string, items = [{ serviceId: piece, quantity: 1 }]): Promise<OrderAdditionInput> {
  const order = await detail(id);
  return { items, requestId: crypto.randomUUID(), reason: 'El cliente agrega otro servicio', expectedTotal: order.total, expectedStatus: order.status };
}
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Se requiere base _test');
  await migrate();
  app = await buildApp();
  owner = await register('Dueño adicionales');
  other = await register('Otra lavandería');
  const employee = await register('Empleado adicionales');
  await db.execute(sql`INSERT INTO memberships(company_id,user_id,role) VALUES (${owner.company},${employee.user},'staff')`);
  staff = { ...employee, company: owner.company };
  customer = (await call(owner, 'POST', '/customers', { name: 'Cliente adicionales', phone: '912345678' })).json().id;
  const services = (await call(owner, 'GET', '/services')).json();
  kg = services.find((s: { unit: string }) => s.unit === 'kg').id;
  piece = services.find((s: { name: string }) => s.name === 'Edredón').id;
  foreignService = (await call(other, 'GET', '/services')).json()[0].id;
});
afterAll(async () => { await app?.close(); await pool.end(); });

describe('servicios adicionales con transacciones reales', () => {
  it('el empleado agrega trabajo al mismo número conservando abonos y deja auditoría', async () => {
    const id = await create();
    const before = await detail(id);
    await call(owner, 'POST', `/orders/${id}/payments`, { amount: 1000, method: 'yape', requestId: crypto.randomUUID() });
    const body = await input(id);
    const result = await call(staff, 'POST', `/orders/${id}/services`, body);
    expect(result.statusCode, result.body).toBe(201);
    const after = await detail(id);
    expect(after).toMatchObject({ number: before.number, total: 4300, paid: 1000, status: 'received', customerId: customer, dueAt: before.dueAt });
    expect(after.items).toHaveLength(2);
    expect(after.payments).toHaveLength(1);
    expect(await one(db, sql`SELECT actor_id AS actor FROM audit WHERE company_id=${owner.company} AND entity_id=${id} AND action='order.services_added'`)).toEqual({ actor: staff.user });
  });

  it('amplía un servicio conservando precio y mínimo históricos, sin cobrarlos dos veces', async () => {
    const service = (await call(owner, 'POST', '/services', { name: 'Servicio histórico', unit: 'kg', price: 600, minimum: 3 })).json().id;
    const id = await create(service);
    await call(owner, 'PUT', `/services/${service}`, { name: 'Servicio con otro precio', unit: 'kg', price: 900, minimum: 5 });
    expect((await call(owner, 'POST', `/orders/${id}/services`, await input(id, [{ serviceId: service, quantity: 0.5 }]))).statusCode).toBe(201);
    expect((await detail(id)).total).toBe(1800);
    expect((await call(owner, 'POST', `/orders/${id}/services`, await input(id, [{ serviceId: service, quantity: 1.25 }]))).statusCode).toBe(201);
    const order = await detail(id);
    expect(order.total).toBe(2250);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ name: 'Servicio histórico', price: 600 });
    expect(Number(order.items[0].actual)).toBe(3.75);
    expect(Number(order.items[0].charged)).toBe(3.75);
  });

  it('serializa reintentos y rechaza reutilización de una clave con otros datos', async () => {
    const id = await create();
    const body = await input(id);
    const results = await Promise.all([1, 2].map(() => call(owner, 'POST', `/orders/${id}/services`, body)));
    expect(results.map(r => r.statusCode)).toEqual([201, 201]);
    expect((await detail(id)).total).toBe(4300);
    expect(await one(db, sql`SELECT count(*)::int AS count FROM audit WHERE company_id=${owner.company} AND entity_id=${id} AND action='order.services_added'`)).toEqual({ count: 1 });
    expect((await call(owner, 'POST', `/orders/${id}/services`, { ...body, items: [{ serviceId: piece, quantity: 2 }] })).statusCode).toBe(409);
    expect((await call(owner, 'POST', `/orders/${await create()}/services`, body)).statusCode).toBe(409);
  });

  it('no pierde pagos concurrentes y detecta un formulario con total obsoleto', async () => {
    const id = await create();
    const body = await input(id);
    const [addition, payment] = await Promise.all([
      call(owner, 'POST', `/orders/${id}/services`, body),
      call(owner, 'POST', `/orders/${id}/payments`, { amount: 1800, method: 'plin', requestId: crypto.randomUUID() }),
    ]);
    expect(addition.statusCode).toBe(201);
    expect(payment.statusCode).toBe(200);
    expect(await detail(id)).toMatchObject({ total: 4300, paid: 1800 });
    expect((await call(owner, 'POST', `/orders/${id}/services`, { ...body, requestId: crypto.randomUUID() })).statusCode).toBe(409);
  });

  it('conserva cantidades históricas de tres decimales al agregar cantidades nuevas', async () => {
    const id = await create();
    await db.transaction(async tx => {
      await tx.execute(sql`UPDATE order_items SET actual=3.125,charged=3.125,price=650,total=2031 WHERE company_id=${owner.company} AND order_id=${id}`);
      await tx.execute(sql`UPDATE orders SET total=2031 WHERE company_id=${owner.company} AND id=${id}`);
    });
    const result = await call(owner, 'POST', `/orders/${id}/services`, await input(id, [{ serviceId: kg, quantity: 0.01 }]));
    expect(result.statusCode).toBe(201);
    const order = await detail(id);
    expect(Number(order.items[0].actual)).toBe(3.135);
    expect(order.total).toBe(2038);
  });

  it('serializa una entrega concurrente: nunca entrega el pedido con trabajo recién agregado', async () => {
    const id = await create();
    await call(owner, 'POST', `/orders/${id}/payments`, { amount: 1800, method: 'yape', requestId: crypto.randomUUID() });
    await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'processing' });
    await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'ready' });
    const body = await input(id);
    const [addition, delivery] = await Promise.all([
      call(owner, 'POST', `/orders/${id}/services`, body),
      call(owner, 'PATCH', `/orders/${id}/status`, { status: 'delivered' }),
    ]);
    const result = await detail(id);
    if (addition.statusCode === 201) {
      expect(delivery.statusCode).toBe(409);
      expect(result).toMatchObject({ status: 'processing', total: 4300, paid: 1800 });
    } else {
      expect(addition.statusCode).toBe(409);
      expect(delivery.statusCode).toBe(200);
      expect(result).toMatchObject({ status: 'delivered', total: 1800, paid: 1800 });
    }
  });

  it('listo vuelve a proceso; exige saldo cero y conserva idempotencia después de entregar', async () => {
    const id = await create();
    await call(owner, 'POST', `/orders/${id}/payments`, { amount: 1800, method: 'yape', requestId: crypto.randomUUID() });
    await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'processing' });
    await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'ready' });
    const body = await input(id);
    expect((await call(owner, 'POST', `/orders/${id}/services`, body)).statusCode).toBe(201);
    expect(await detail(id)).toMatchObject({ status: 'processing', total: 4300, paid: 1800 });
    await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'ready' });
    expect((await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'delivered' })).statusCode).toBe(409);
    await call(owner, 'POST', `/orders/${id}/payments`, { amount: 2500, method: 'yape', requestId: crypto.randomUUID() });
    await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'delivered' });
    expect((await call(owner, 'POST', `/orders/${id}/services`, body)).statusCode).toBe(201);
    expect((await call(owner, 'POST', `/orders/${id}/services`, { ...body, requestId: crypto.randomUUID() })).statusCode).toBe(409);
    expect((await detail(id)).status).toBe('delivered');
  });

  it('rechaza órdenes cerradas, otra empresa y servicios extranjeros sin cambios parciales', async () => {
    const id = await create();
    const body = await input(id, [{ serviceId: piece, quantity: 1 }, { serviceId: foreignService, quantity: 1 }]);
    expect((await call(owner, 'POST', `/orders/${id}/services`, body)).statusCode).toBe(400);
    expect(await detail(id)).toMatchObject({ total: 1800, paid: 0 });
    expect((await detail(id)).items).toHaveLength(1);
    expect(await one(db, sql`SELECT request_id FROM order_additions WHERE company_id=${owner.company} AND request_id=${body.requestId}`)).toBeUndefined();
    expect((await call(other, 'POST', `/orders/${id}/services`, await input(id))).statusCode).toBe(404);
    await call(owner, 'POST', `/orders/${id}/cancel`, { reason: 'Cliente cancela su pedido' });
    expect((await call(owner, 'POST', `/orders/${id}/services`, await input(id))).statusCode).toBe(409);
  });

  it('valida cada pieza antes de agrupar y no acepta precios del navegador', async () => {
    const id = await create();
    const body = await input(id, [{ serviceId: piece, quantity: 0.5 }, { serviceId: piece, quantity: 0.5 }]);
    expect((await call(owner, 'POST', `/orders/${id}/services`, body)).statusCode).toBe(400);
    expect((await call(owner, 'POST', '/orders', { customerId: customer, dueAt: new Date().toISOString(), items: body.items, requestId: crypto.randomUUID() })).statusCode).toBe(400);
    expect((await call(owner, 'POST', `/orders/${id}/services`, { ...await input(id), total: 1 })).statusCode).toBe(400);
    expect((await detail(id)).total).toBe(1800);
  });
});
