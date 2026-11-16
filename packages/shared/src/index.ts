import { z } from 'zod';

export const roles = ['owner', 'manager', 'staff'] as const;
export const statuses = ['received', 'processing', 'ready', 'delivered', 'cancelled'] as const;
export const methods = ['cash', 'yape', 'plin', 'card', 'transfer'] as const;
export const id = z.string().uuid();
export const money = z.number().int().min(0).max(100_000_000);
const name = z.string().trim().min(2).max(120);
export const credentials = z.object({ email: z.email().toLowerCase(), password: z.string().min(12).max(128) });
export const registration = credentials.extend({ name, company: name });
export const customerInput = z.object({ name, phone: z.string().trim().regex(/^\+?[0-9 ()-]{0,20}$/), document: z.string().trim().max(20).default(''), notes: z.string().trim().max(1000).default('') });
export const serviceInput = z.object({ name, unit: z.enum(['kg', 'piece']), price: money.refine(v => v > 0), minimum: z.number().min(0).max(1000), active: z.boolean().default(true) }).refine(v => v.unit !== 'piece' || Number.isInteger(v.minimum), { message: 'El mínimo por pieza debe ser entero' });
export const orderInput = z.object({ customerId: id, dueAt: z.iso.datetime(), notes: z.string().trim().max(2000).default(''), items: z.array(z.object({ serviceId: id, quantity: z.number().positive().max(10000).refine(v => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001, 'Máximo tres decimales') })).min(1).max(50), requestId: id });
export const paymentInput = z.object({ amount: money.refine(v => v > 0), method: z.enum(methods), reference: z.string().trim().max(120).default(''), requestId: id });
export const reasonInput = z.object({ reason: z.string().trim().min(5).max(500) });
export const refundInput = reasonInput.extend({ amount: money.refine(v => v > 0), method: z.enum(methods), requestId: id });
export const invitationInput = z.object({ email: z.email().toLowerCase(), role: z.enum(['manager', 'staff']) });
export type CustomerInput = z.infer<typeof customerInput>;
export type ServiceInput = z.infer<typeof serviceInput>;
export type OrderInput = z.infer<typeof orderInput>;
export type Role = typeof roles[number];
export type Status = typeof statuses[number];
export interface Membership { companyId: string; companyName: string; role: Role }
export interface Identity { id: string; name: string; email: string; platformAdmin: boolean; memberships: Membership[] }
export interface Customer extends CustomerInput { id: string }
export interface Service extends ServiceInput { id: string }
export interface Order { id: string; number: number; customerId: string; customerName: string; phone: string; status: Status; total: number; paid: number; dueAt: string; notes: string; createdAt: string }
export interface OrderItem { name: string; unit: string; actual: string; charged: string; price: number; total: number }
export interface Payment { id: string; amount: number; method: string; reference: string; reason: string | null; createdAt: string }
export interface OrderDetail extends Order { items: OrderItem[]; payments: Payment[] }
export interface Cash { id: string; openedAt: string; opening: number; expected: number; closedAt: string | null; counted: number | null }
export interface Report { orders: number; sales: number; outstanding: number; collected: number; active: number; ready: number }
export interface Audit { id: string; action: string; entityId: string | null; createdAt: string; actor: string; detail: unknown }
export interface PlatformCompany { id: string; name: string; status: string; subscriptionDue: number; orders: number; outstanding: number; collected: number }
export interface PlatformDetail {
  company: { id: string; name: string; status: string; subscriptionDue: number };
  members: { id: string; name: string; email: string; role: Role }[];
  balances: { id: string; name: string; phone: string; outstanding: number }[];
  orders: Order[];
}

// PEN in integer céntimos; quantities in thousandths. Minimum applies to a service's grouped quantity.
export function priceLine(quantity: number, minimum: number, price: number) {
  const actual = Math.round(quantity * 1000);
  const charged = Math.max(actual, Math.round(minimum * 1000));
  return { actual: actual / 1000, charged: charged / 1000, total: Math.round(charged * price / 1000) };
}
