import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerInput, serviceInput, orderInput, paymentInput, refundInput, reasonInput, priceLine, id, money, type Order, type Service } from '@lav/shared';
import { db, sql, rows, one, type Executor } from './db.js';
import { tenant, assert, audit, hash } from './security.js';

const paramId = (params: unknown) => z.object({ id }).parse(params).id;
const orderColumns = sql`o.id,o.number,o.customer_id AS "customerId",c.name AS "customerName",c.phone,o.status,o.total,o.paid,o.due_at AS "dueAt",o.notes,o.created_at AS "createdAt"`;
async function lockCompany(tx: Executor, companyId: string) { await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} FOR UPDATE`); }
export async function operationRoutes(app: FastifyInstance) {
  app.get('/api/customers', async request => { const ctx = await tenant(request); return rows(db, sql`SELECT id,name,phone,document,notes FROM customers WHERE company_id=${ctx.companyId} ORDER BY name LIMIT 2000`); });
  app.post('/api/customers', async (request, reply) => {
    const ctx = await tenant(request); const input = customerInput.parse(request.body);
    return reply.code(201).send(await db.transaction(async tx => {
      const result = (await one(tx, sql`INSERT INTO customers(company_id,name,phone,document,notes) VALUES (${ctx.companyId},${input.name},${input.phone},${input.document},${input.notes}) RETURNING id,name,phone,document,notes`))!;
      await audit(tx, ctx.actor.id, ctx.companyId, 'customer.created', result.id as string); return result;
    }));
  });
  app.put('/api/customers/:id', async request => {
    const ctx = await tenant(request); const customerId = paramId(request.params); const input = customerInput.parse(request.body);
    return db.transaction(async tx => {
      const result = await one(tx, sql`UPDATE customers SET name=${input.name},phone=${input.phone},document=${input.document},notes=${input.notes} WHERE id=${customerId} AND company_id=${ctx.companyId} RETURNING id`);
      assert(result, 404, 'Cliente no encontrado'); await audit(tx, ctx.actor.id, ctx.companyId, 'customer.updated', customerId); return result;
    });
  });
  app.get('/api/services', async request => { const ctx = await tenant(request); return rows(db, sql`SELECT id,name,unit,price,minimum::float8 AS minimum,active FROM services WHERE company_id=${ctx.companyId} ORDER BY name`); });
  app.post('/api/services', async (request, reply) => {
    const ctx = await tenant(request, ['owner', 'manager']); const input = serviceInput.parse(request.body);
    return reply.code(201).send(await db.transaction(async tx => {
      const result = (await one(tx, sql`INSERT INTO services(company_id,name,unit,price,minimum,active) VALUES (${ctx.companyId},${input.name},${input.unit},${input.price},${input.minimum},${input.active}) RETURNING id`))!;
      await audit(tx, ctx.actor.id, ctx.companyId, 'service.created', result.id as string, input); return result;
    }));
  });
  app.put('/api/services/:id', async request => {
    const ctx = await tenant(request, ['owner', 'manager']); const serviceId = paramId(request.params); const input = serviceInput.parse(request.body);
    return db.transaction(async tx => {
      const result = await one(tx, sql`UPDATE services SET name=${input.name},unit=${input.unit},price=${input.price},minimum=${input.minimum},active=${input.active} WHERE id=${serviceId} AND company_id=${ctx.companyId} RETURNING id`);
      assert(result, 404, 'Servicio no encontrado'); await audit(tx, ctx.actor.id, ctx.companyId, 'service.updated', serviceId, input); return result;
    });
  });
  app.get('/api/orders', async request => {
    const ctx = await tenant(request);
    const { search, status, offset } = z.object({ search: z.string().max(120).default(''), status: z.enum(['all', 'received', 'processing', 'ready', 'delivered', 'cancelled']).default('all'), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return rows(db, sql`SELECT ${orderColumns} FROM orders o JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id WHERE o.company_id=${ctx.companyId} AND (${status}='all' OR o.status=${status}) AND (c.name ILIKE ${`%${search}%`} OR o.number::text=${search} OR c.phone ILIKE ${`%${search}%`}) ORDER BY o.created_at DESC LIMIT 100 OFFSET ${offset}`);
  });
  app.get('/api/orders/:id', async request => {
    const ctx = await tenant(request); const orderId = paramId(request.params);
    const order = await one(db, sql`SELECT ${orderColumns} FROM orders o JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id WHERE o.company_id=${ctx.companyId} AND o.id=${orderId}`);
    assert(order, 404, 'Orden no encontrada');
    const items = await rows(db, sql`SELECT name,unit,actual,charged,price,total FROM order_items WHERE company_id=${ctx.companyId} AND order_id=${orderId} ORDER BY name`);
    const payments = await rows(db, sql`SELECT id,amount,method,reference,reason,created_at AS "createdAt" FROM payments WHERE company_id=${ctx.companyId} AND order_id=${orderId} ORDER BY created_at DESC`);
    return { ...order, items, payments };
  });
  app.post('/api/orders', async (request, reply) => {
    const ctx = await tenant(request); const input = orderInput.parse(request.body); const fingerprint = hash(JSON.stringify(input));
    const result = await db.transaction(async tx => {
      await lockCompany(tx, ctx.companyId);
      const existing = await one<{ id: string; requestHash: string }>(tx, sql`SELECT id,request_hash AS "requestHash" FROM orders WHERE company_id=${ctx.companyId} AND request_id=${input.requestId}`);
      if (existing) { assert(existing.requestHash === fingerprint, 409, 'La solicitud ya se utilizó con otros datos'); return { id: existing.id }; }
      assert(await one(tx, sql`SELECT id FROM customers WHERE company_id=${ctx.companyId} AND id=${input.customerId}`), 404, 'Cliente no encontrado');
      const grouped = new Map<string, number>();
      for (const item of input.items) grouped.set(item.serviceId, (grouped.get(item.serviceId) ?? 0) + Math.round(item.quantity * 1000));
      const items = [];
      for (const [serviceId, milli] of grouped) {
        const service = await one<Service>(tx, sql`SELECT id,name,unit,price,minimum::float8 AS minimum,active FROM services WHERE id=${serviceId} AND company_id=${ctx.companyId} FOR SHARE`);
        assert(service?.active, 400, 'Servicio no disponible');
        assert(service.unit !== 'piece' || milli % 1000 === 0, 400, 'Las piezas deben ser enteras');
        items.push({ service, ...priceLine(milli / 1000, service.minimum, service.price) });
      }
      const total = items.reduce((sum, item) => sum + item.total, 0);
      assert(total > 0 && total <= 100_000_000, 400, 'Total fuera de rango');
      const counter = (await one<{ number: number }>(tx, sql`UPDATE companies SET next_order=next_order+1 WHERE id=${ctx.companyId} RETURNING next_order-1 AS number`))!;
      const order = (await one<{ id: string }>(tx, sql`INSERT INTO orders(company_id,branch_id,customer_id,number,request_id,request_hash,total,due_at,notes) VALUES (${ctx.companyId},${ctx.branchId},${input.customerId},${counter.number},${input.requestId},${fingerprint},${total},${input.dueAt},${input.notes}) RETURNING id`))!;
      for (const item of items) await tx.execute(sql`INSERT INTO order_items(company_id,order_id,service_id,name,unit,actual,charged,price,total) VALUES (${ctx.companyId},${order.id},${item.service.id},${item.service.name},${item.service.unit},${item.actual},${item.charged},${item.service.price},${item.total})`);
      await audit(tx, ctx.actor.id, ctx.companyId, 'order.created', order.id, { total, number: counter.number }); return order;
    }); return reply.code(201).send(result);
  });
  app.patch('/api/orders/:id/status', async request => {
    const ctx = await tenant(request); const orderId = paramId(request.params); const { status } = z.object({ status: z.enum(['processing', 'ready', 'delivered']) }).parse(request.body);
    return db.transaction(async tx => {
      const order = await one<Order>(tx, sql`SELECT status,total,paid FROM orders WHERE id=${orderId} AND company_id=${ctx.companyId} FOR UPDATE`);
      assert(order, 404, 'Orden no encontrada');
      const next: Record<string, string> = { received: 'processing', processing: 'ready', ready: 'delivered' };
      assert(next[order.status] === status, 409, 'Transición de estado no permitida');
      assert(status !== 'delivered' || order.total === order.paid, 409, 'Cobra el saldo antes de entregar');
      await tx.execute(sql`UPDATE orders SET status=${status} WHERE id=${orderId} AND company_id=${ctx.companyId}`);
      await audit(tx, ctx.actor.id, ctx.companyId, `order.${status}`, orderId); return { ok: true };
    });
  });
  app.patch('/api/orders/:id', async request => {
    const ctx = await tenant(request, ['owner', 'manager']); const orderId = paramId(request.params);
    const input = reasonInput.extend({ dueAt: z.iso.datetime(), notes: z.string().max(2000) }).parse(request.body);
    return db.transaction(async tx => {
      const result = await one(tx, sql`UPDATE orders SET due_at=${input.dueAt},notes=${input.notes} WHERE company_id=${ctx.companyId} AND id=${orderId} AND status NOT IN ('cancelled','delivered') RETURNING id`);
      assert(result, 409, 'No se puede corregir esta orden'); await audit(tx, ctx.actor.id, ctx.companyId, 'order.corrected', orderId, input); return result;
    });
  });
  app.post('/api/orders/:id/cancel', async request => {
    const ctx = await tenant(request, ['owner', 'manager']); const orderId = paramId(request.params); const input = reasonInput.parse(request.body);
    return db.transaction(async tx => {
      const order = await one<Order>(tx, sql`SELECT status,paid FROM orders WHERE company_id=${ctx.companyId} AND id=${orderId} FOR UPDATE`);
      assert(order, 404, 'Orden no encontrada'); assert(!['delivered', 'cancelled'].includes(order.status) && order.paid === 0, 409, 'Devuelve los abonos antes de anular; una orden entregada no se anula');
      await tx.execute(sql`UPDATE orders SET status='cancelled' WHERE company_id=${ctx.companyId} AND id=${orderId}`);
      await audit(tx, ctx.actor.id, ctx.companyId, 'order.cancelled', orderId, input); return { ok: true };
    });
  });
  for (const refund of [false, true]) app.post(`/api/orders/:id/${refund ? 'refunds' : 'payments'}`, async request => {
    const ctx = await tenant(request, refund ? ['owner', 'manager'] : ['owner', 'manager', 'staff']); const orderId = paramId(request.params);
    const input = refund ? refundInput.parse(request.body) : paymentInput.parse(request.body);
    const fingerprint = hash(JSON.stringify({ orderId, refund, ...input }));
    return db.transaction(async tx => {
      await lockCompany(tx, ctx.companyId);
      const existing = await one<{ id: string; requestHash: string }>(tx, sql`SELECT id,request_hash AS "requestHash" FROM payments WHERE company_id=${ctx.companyId} AND request_id=${input.requestId}`);
      if (existing) { assert(existing.requestHash === fingerprint, 409, 'La solicitud ya se utilizó con otros datos'); return { id: existing.id }; }
      const order = await one<Order>(tx, sql`SELECT status,total,paid FROM orders WHERE company_id=${ctx.companyId} AND id=${orderId} FOR UPDATE`);
      assert(order, 404, 'Orden no encontrada'); assert(!['cancelled', 'delivered'].includes(order.status), 409, 'La orden está cerrada');
      assert(input.amount <= (refund ? order.paid : order.total - order.paid), 409, refund ? 'Devolución mayor al importe cobrado' : 'El pago supera el saldo');
      let cashId: string | null = null;
      if (input.method === 'cash') {
        const cash = await one<{ id: string }>(tx, sql`SELECT id FROM cash_sessions WHERE company_id=${ctx.companyId} AND branch_id=${ctx.branchId} AND closed_at IS NULL FOR UPDATE`);
        assert(cash, 409, 'Abre la caja antes de registrar efectivo'); cashId = cash.id;
      }
      const amount = refund ? -input.amount : input.amount;
      const result = (await one(tx, sql`INSERT INTO payments(company_id,order_id,cash_id,amount,method,reference,reason,request_id,request_hash,actor_id) VALUES (${ctx.companyId},${orderId},${cashId},${amount},${input.method},${'reference' in input ? input.reference : ''},${'reason' in input ? input.reason : null},${input.requestId},${fingerprint},${ctx.actor.id}) RETURNING id`))!;
      await tx.execute(sql`UPDATE orders SET paid=paid+${amount} WHERE company_id=${ctx.companyId} AND id=${orderId}`);
      await audit(tx, ctx.actor.id, ctx.companyId, refund ? 'payment.refunded' : 'payment.created', orderId, { amount, method: input.method, paymentId: result.id }); return result;
    });
  });
  app.get('/api/cash', async request => {
    const ctx = await tenant(request);
    return rows(db, sql`SELECT c.id,c.opened_at AS "openedAt",c.closed_at AS "closedAt",c.opening,c.counted,COALESCE(c.expected,c.opening+COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.company_id=c.company_id AND p.cash_id=c.id),0))::int AS expected FROM cash_sessions c WHERE c.company_id=${ctx.companyId} AND c.branch_id=${ctx.branchId} ORDER BY c.opened_at DESC LIMIT 50`);
  });
  app.post('/api/cash/open', async request => {
    const ctx = await tenant(request); const { opening } = z.object({ opening: money }).parse(request.body);
    return db.transaction(async tx => {
      await lockCompany(tx, ctx.companyId);
      assert(!await one(tx, sql`SELECT id FROM cash_sessions WHERE company_id=${ctx.companyId} AND branch_id=${ctx.branchId} AND closed_at IS NULL`), 409, 'Ya hay una caja abierta');
      const result = (await one(tx, sql`INSERT INTO cash_sessions(company_id,branch_id,opened_by,opening) VALUES (${ctx.companyId},${ctx.branchId},${ctx.actor.id},${opening}) RETURNING id`))!;
      await audit(tx, ctx.actor.id, ctx.companyId, 'cash.opened', result.id as string, { opening }); return result;
    });
  });
  app.post('/api/cash/:id/close', async request => {
    const ctx = await tenant(request, ['owner', 'manager']); const cashId = paramId(request.params); const { counted } = z.object({ counted: money }).parse(request.body);
    return db.transaction(async tx => {
      await lockCompany(tx, ctx.companyId);
      const cash = await one<{ opening: number }>(tx, sql`SELECT opening FROM cash_sessions WHERE id=${cashId} AND company_id=${ctx.companyId} AND closed_at IS NULL FOR UPDATE`);
      assert(cash, 409, 'Caja no disponible'); const sums = (await one<{ total: number }>(tx, sql`SELECT COALESCE(SUM(amount),0)::int AS total FROM payments WHERE company_id=${ctx.companyId} AND cash_id=${cashId}`))!;
      const expected = cash.opening + sums.total;
      await tx.execute(sql`UPDATE cash_sessions SET closed_at=now(),counted=${counted},expected=${expected} WHERE id=${cashId} AND company_id=${ctx.companyId}`);
      await audit(tx, ctx.actor.id, ctx.companyId, 'cash.closed', cashId, { expected, counted, difference: counted - expected }); return { expected, counted };
    });
  });
}
