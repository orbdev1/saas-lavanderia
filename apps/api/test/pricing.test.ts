import { describe, expect, it } from 'vitest';
import { priceLine, orderInput } from '@lav/shared';
describe('precios en céntimos', () => {
  it('cobra el mínimo preservando el peso real', () => { expect(priceLine(2, 3, 600)).toEqual({ actual: 2, charged: 3, total: 1800 }); });
  it('redondea fracciones de céntimo una vez por línea', () => { expect(priceLine(3.125, 3, 650).total).toBe(2031); });
  it('admite mínimo desactivado', () => { expect(priceLine(0.5, 0, 600).total).toBe(300); });
  it('rechaza cantidades con precisión no soportada', () => { expect(orderInput.safeParse({ customerId: crypto.randomUUID(), dueAt: new Date().toISOString(), requestId: crypto.randomUUID(), items: [{ serviceId: crypto.randomUUID(), quantity: 0.0001 }] }).success).toBe(false); });
});
