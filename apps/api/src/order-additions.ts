import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { id, orderAdditionInput, priceLine, type Order, type OrderItem, type Service } from '@lav/shared';
import { db, sql, one, rows } from './db.js';
import { tenant, assert, hash, audit } from './security.js';

export async function orderAdditionRoutes(app: FastifyInstance) {
  app.post('/api/orders/:id/services', async (request, reply) => {
    const ctx = await tenant(request);
    const orderId = z.object({ id }).parse(request.params).id;
    const input = orderAdditionInput.parse(request.body);
    const fingerprint = hash(JSON.stringify({ orderId, ...input }));

    const result = await db.transaction(async tx => {
      // Same financial lock order as payments: company -> order -> cash (if needed).
      await tx.execute(sql`SELECT id FROM companies WHERE id=${ctx.companyId} FOR UPDATE`);
      const previous = await one<{ orderId: string; requestHash: string }>(tx, sql`
        SELECT order_id AS "orderId",request_hash AS "requestHash" FROM order_additions
        WHERE company_id=${ctx.companyId} AND request_id=${input.requestId}
      `);
      if (previous) {
        assert(previous.requestHash === fingerprint, 409, 'La solicitud ya se utilizó con otros datos');
        return { id: previous.orderId };
      }

      const order = await one<Pick<Order, 'total' | 'paid' | 'status'>>(tx, sql`
        SELECT total,paid,status FROM orders WHERE company_id=${ctx.companyId} AND id=${orderId} FOR UPDATE
      `);
      assert(order, 404, 'Orden no encontrada');
      assert(!['cancelled', 'delivered'].includes(order.status), 409, 'No se agregan servicios a una orden entregada o anulada');
      assert(order.total === input.expectedTotal && order.status === input.expectedStatus, 409,
        'El pedido cambió. Cierra este formulario, actualiza el detalle y revisa los importes antes de volver a agregar.');

      const before = await rows<OrderItem & { id: string }>(tx, sql`
        SELECT id,service_id AS "serviceId",name,unit,actual,charged,price,total
        FROM order_items WHERE company_id=${ctx.companyId} AND order_id=${orderId} ORDER BY service_id
      `);
      const grouped = new Map<string, number>();
      for (const item of input.items) grouped.set(item.serviceId, (grouped.get(item.serviceId) ?? 0) + Math.round(item.quantity * 1000));
      assert(new Set([...before.map(i => i.serviceId), ...grouped.keys()]).size <= 50, 400, 'Máximo 50 servicios distintos por pedido');
      let total = order.total;
      const changes: unknown[] = [];

      // Stable catalog lock order also avoids deadlocks with future batch catalog edits.
      for (const [serviceId, addedMilli] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
        const service = await one<Service>(tx, sql`
          SELECT id,name,unit,price,minimum::float8 AS minimum,active FROM services
          WHERE company_id=${ctx.companyId} AND id=${serviceId} FOR SHARE
        `);
        assert(service?.active, 400, 'Servicio no disponible');
        assert(service.unit !== 'piece' || input.items.filter(i => i.serviceId === serviceId).every(i => Number.isInteger(i.quantity)),
          400, 'Las piezas deben ser enteras');
        const original = before.find(i => i.serviceId === serviceId);
        assert(!original || original.unit === service.unit, 409, 'La unidad del servicio cambió. Usa un servicio distinto del catálogo');
        const actualMilli = Math.round(Number(original?.actual ?? 0) * 1000) + addedMilli;
        assert(actualMilli <= 10_000_000, 400, 'La cantidad acumulada supera el máximo de 10000 por servicio');

        // charged already snapshots max(actual, minimum). As additions only increase
        // quantity, it preserves the original minimum without guessing old catalog rules.
        const price = original?.price ?? service.price;
        const priced = priceLine(actualMilli / 1000, original ? Number(original.charged) : service.minimum, price);
        total += priced.total - (original?.total ?? 0);
        assert(total > 0 && total <= 100_000_000, 400, 'Total fuera de rango');
        if (original) {
          await tx.execute(sql`UPDATE order_items SET actual=${priced.actual},charged=${priced.charged},total=${priced.total}
            WHERE company_id=${ctx.companyId} AND order_id=${orderId} AND id=${original.id}`);
        } else {
          await tx.execute(sql`INSERT INTO order_items(company_id,order_id,service_id,name,unit,actual,charged,price,total)
            VALUES (${ctx.companyId},${orderId},${serviceId},${service.name},${service.unit},${priced.actual},${priced.charged},${price},${priced.total})`);
        }
        changes.push({ serviceId, added: addedMilli / 1000, before: original ?? null, after: { ...priced, price } });
      }
      assert(total >= order.total && total >= order.paid, 409, 'El añadido no puede reducir el total ni los pagos');
      const status = order.status === 'ready' ? 'processing' : order.status;
      await tx.execute(sql`UPDATE orders SET total=${total},status=${status} WHERE company_id=${ctx.companyId} AND id=${orderId}`);
      await tx.execute(sql`INSERT INTO order_additions(company_id,request_id,order_id,request_hash)
        VALUES (${ctx.companyId},${input.requestId},${orderId},${fingerprint})`);
      await audit(tx, ctx.actor.id, ctx.companyId, 'order.services_added', orderId, {
        requestId: input.requestId, reason: input.reason, before: order, after: { total, paid: order.paid, status }, changes,
      });
      return { id: orderId };
    });
    return reply.code(201).send(result);
  });
}
