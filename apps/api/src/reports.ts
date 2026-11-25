import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { id, money } from '@lav/shared';
import { db, sql, rows, one } from './db.js';
import { tenant, platform, audit, assert } from './security.js';
import { csvDocument } from './csv.js';

export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports', async request => {
    const ctx = await tenant(request);
    return one(db, sql`SELECT COUNT(*) FILTER(WHERE status<>'cancelled')::int AS orders,COALESCE(SUM(total) FILTER(WHERE status<>'cancelled'),0)::float8 AS sales,COALESCE(SUM(total-paid) FILTER(WHERE status<>'cancelled'),0)::float8 AS outstanding,COALESCE(SUM(paid),0)::float8 AS collected,COUNT(*) FILTER(WHERE status IN ('received','processing','ready'))::int AS active,COUNT(*) FILTER(WHERE status='ready')::int AS ready FROM orders WHERE company_id=${ctx.companyId}`);
  });
  app.get('/api/reports/export', async (request, reply) => {
    const ctx = await tenant(request, ['owner', 'manager']);
    const data = await rows(db, sql`SELECT o.number,c.name AS customer,o.status,o.total,o.paid,o.total-o.paid AS balance,o.created_at,o.due_at FROM orders o JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id WHERE o.company_id=${ctx.companyId} ORDER BY o.number`);
    const header = ['number', 'customer', 'status', 'total', 'paid', 'balance', 'created_at', 'due_at'];
    await audit(db, ctx.actor.id, ctx.companyId, 'report.exported', null);
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="ordenes-centimos.csv"').send(csvDocument(header, data));
  });
  app.get('/api/customers/export', async (request, reply) => {
    const ctx = await tenant(request, ['owner', 'manager']);
    const data = await rows(db, sql`SELECT name AS nombre,phone AS celular,document AS documento,notes AS notas FROM customers WHERE company_id=${ctx.companyId} ORDER BY name,id`);
    await audit(db, ctx.actor.id, ctx.companyId, 'customers.exported', null, { count: data.length });
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="clientes.csv"').send(csvDocument(['nombre', 'celular', 'documento', 'notas'], data));
  });
  app.get('/api/audit', async request => { const ctx = await tenant(request, ['owner', 'manager']); return rows(db, sql`SELECT a.id,a.action,a.entity_id AS "entityId",a.detail,a.created_at AS "createdAt",u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.company_id=${ctx.companyId} ORDER BY a.created_at DESC LIMIT 200`); });
  app.get('/api/platform/companies', async request => {
    const actor = await platform(request);
    await audit(db, actor.id, null, 'platform.metrics.viewed', null);
    return rows(db, sql`SELECT c.id,c.name,c.status,c.subscription_due AS "subscriptionDue",COUNT(o.id)::int AS orders,COALESCE(SUM(o.total-o.paid) FILTER(WHERE o.status<>'cancelled'),0)::float8 AS outstanding,COALESCE(SUM(o.paid),0)::float8 AS collected FROM companies c LEFT JOIN orders o ON o.company_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`);
  });
  app.get('/api/platform/companies/:id', async request => {
    const actor = await platform(request); const companyId = z.object({ id }).parse(request.params).id;
    return db.transaction(async tx => {
      const company = await one(tx, sql`SELECT id,name,status,subscription_due AS "subscriptionDue" FROM companies WHERE id=${companyId}`);
      assert(company, 404, 'Empresa no encontrada');
      await audit(tx, actor.id, companyId, 'platform.company.viewed', companyId);
      const members = await rows(tx, sql`SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=${companyId} ORDER BY u.name`);
      const balances = await rows(tx, sql`SELECT c.id,c.name,c.phone,COALESCE(SUM(o.total-o.paid) FILTER(WHERE o.status<>'cancelled'),0)::float8 AS outstanding FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.company_id=c.company_id WHERE c.company_id=${companyId} GROUP BY c.id ORDER BY outstanding DESC LIMIT 200`);
      const orders = await rows(tx, sql`SELECT o.id,o.number,o.customer_id AS "customerId",c.name AS "customerName",c.phone,o.status,o.total,o.paid,o.due_at AS "dueAt",o.notes,o.created_at AS "createdAt" FROM orders o JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id WHERE o.company_id=${companyId} ORDER BY o.created_at DESC LIMIT 100`);
      return { company, members, balances, orders };
    });
  });
  app.patch('/api/platform/companies/:id', async request => {
    const actor = await platform(request); const companyId = z.object({ id }).parse(request.params).id;
    const input = z.object({ status: z.enum(['active', 'suspended']), subscriptionDue: money, reason: z.string().trim().min(5).max(500) }).parse(request.body);
    return db.transaction(async tx => {
      const result = await one(tx, sql`UPDATE companies SET status=${input.status},subscription_due=${input.subscriptionDue} WHERE id=${companyId} RETURNING id`);
      assert(result, 404, 'Empresa no encontrada'); await audit(tx, actor.id, companyId, 'platform.subscription.updated', companyId, input); return result;
    });
  });
}
