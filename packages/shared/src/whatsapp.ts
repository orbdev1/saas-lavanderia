import type { OrderDetail } from './index.js';

export type WhatsAppNotice = 'received' | 'ready';

export function whatsAppPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const international = /^9\d{8}$/.test(digits) ? `51${digits}` : digits;
  return /^[1-9]\d{7,14}$/.test(international) ? international : null;
}

export function buildWhatsAppNotice(order: OrderDetail, companyName: string, notice: WhatsAppNotice): string {
  if (order.status === 'cancelled' || order.status === 'delivered') throw new Error('El pedido está cerrado.');
  if (notice === 'ready' && order.status !== 'ready') throw new Error('El pedido todavía no está listo para recoger.');
  const money = (value: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value / 100);
  const number = String(order.number).padStart(4, '0');
  const balance = order.total - order.paid;
  const lines = [`Hola, ${order.customerName}.`, ''];
  if (notice === 'received') {
    lines.push(`Registramos tu pedido N.° ${number} en ${companyName}.`, '', 'Servicios solicitados:');
    for (const item of order.items) {
      lines.push(`• ${item.name}: ${Number(item.actual).toLocaleString('es-PE', { maximumFractionDigits: 3 })} ${item.unit === 'kg' ? 'kg' : 'pieza(s)'}`);
    }
    const due = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(order.dueAt));
    lines.push('', `Entrega estimada: ${due}`, `Total: ${money(order.total)}`, `Abonado: ${money(order.paid)}`);
  } else {
    lines.push(`Tu pedido N.° ${number} de ${companyName} ya está listo para recoger.`, '');
  }
  lines.push(balance > 0 ? `Saldo pendiente: ${money(balance)}` : 'Pedido pagado. No tienes saldo pendiente.');
  lines.push('', notice === 'received' ? 'Te avisaremos cuando esté listo para recoger. ¡Gracias!' : '¡Te esperamos!');
  return lines.join('\n');
}
