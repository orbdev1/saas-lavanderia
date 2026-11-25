import { describe, expect, it } from 'vitest';
import { buildWhatsAppNotice, whatsAppPhone, type OrderDetail } from '@lav/shared';

const order: OrderDetail = {
  id: 'order', number: 125, customerId: 'customer', customerName: 'María', phone: '912345678',
  status: 'received', total: 2400, paid: 1000, dueAt: '2026-11-18T22:00:00.000Z', notes: 'Nota interna privada',
  createdAt: '2026-11-15T12:00:00.000Z',
  items: [{ serviceId: 'service', name: 'Lavado por kilo', unit: 'kg', actual: '4', charged: '4', price: 600, total: 2400 }],
  payments: [],
};

describe('avisos manuales de WhatsApp', () => {
  it('normaliza celulares peruanos y rechaza destinos vacíos o fuera de formato', () => {
    expect(whatsAppPhone('912 345 678')).toBe('51912345678');
    expect(whatsAppPhone('+51 (912) 345 678')).toBe('51912345678');
    expect(whatsAppPhone('')).toBeNull();
    expect(whatsAppPhone('012345678')).toBeNull();
    expect(whatsAppPhone('1234567890123456')).toBeNull();
  });
  it('incluye servicios, fecha estimada en Lima y desglose sin notas internas', () => {
    const message = buildWhatsAppNotice(order, 'Lavandería Central', 'received');
    expect(message).toContain('N.° 0125');
    expect(message).toContain('Lavado por kilo: 4 kg');
    expect(message).toContain('18/11/26');
    expect(message).toContain('5:00');
    expect(message).toMatch(/Total: S\/\s24\.00/);
    expect(message).toMatch(/Abonado: S\/\s10\.00/);
    expect(message).toMatch(/Saldo pendiente: S\/\s14\.00/);
    expect(message).not.toContain('Nota interna');
  });
  it('distingue listo con deuda, pagado y estados que no deben notificarse', () => {
    expect(() => buildWhatsAppNotice(order, 'Central', 'ready')).toThrow('todavía no está listo');
    expect(buildWhatsAppNotice({ ...order, status: 'ready' }, 'Central', 'ready')).toMatch(/Saldo pendiente: S\/\s14\.00/);
    expect(buildWhatsAppNotice({ ...order, status: 'ready', paid: 2400 }, 'Central', 'ready')).toContain('No tienes saldo pendiente');
    expect(() => buildWhatsAppNotice({ ...order, status: 'cancelled' }, 'Central', 'received')).toThrow('cerrado');
    expect(() => buildWhatsAppNotice({ ...order, status: 'delivered' }, 'Central', 'ready')).toThrow('cerrado');
  });
});
