export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export let companyId = localStorage.getItem('companyId') ?? '';
export function selectCompany(id: string) { companyId = id; localStorage.setItem('companyId', id); }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(companyId ? { 'X-Company-Id': companyId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new ApiError(response.status, error.message || 'No se pudo conectar al servidor'); }
  return response.json() as Promise<T>;
}
export async function exportOrders() {
  const response = await fetch('/api/reports/export', { headers: { 'X-Company-Id': companyId } });
  if (!response.ok) throw new Error('No se pudo exportar');
  const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'ordenes-centimos.csv'; a.click(); URL.revokeObjectURL(url);
}
export const currency = (cents: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(cents / 100);
export const date = (value: string) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value));
export const cents = (value: FormDataEntryValue | null) => Math.round(Number(value) * 100);
export const statusLabel: Record<string, string> = { received: 'Recibido', processing: 'En proceso', ready: 'Listo', delivered: 'Entregado', cancelled: 'Anulado' };
