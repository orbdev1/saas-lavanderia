import { queryClient } from './query-client';
import { useWorkspaceStore } from './workspace-store';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export let companyId = localStorage.getItem('companyId') ?? '';
export function selectCompany(id: string) { queryClient.clear(); useWorkspaceStore.getState().reset(); companyId = id; localStorage.setItem('companyId', id); }
async function responseError(response: Response, path = ''): Promise<never> {
  const error = await response.json().catch(() => ({}));
  if (response.status === 401 && (error.code === 'SESSION_EXPIRED' || !/^\/auth\/(login|password|mfa|reset)/.test(path))) window.dispatchEvent(new Event('lavanda:session-expired'));
  if (['COMPANY_SUSPENDED', 'COMPANY_ACCESS_REVOKED', 'PASSWORD_CHANGE_REQUIRED', 'MFA_REQUIRED'].includes(error.code)) window.dispatchEvent(new Event('lavanda:access-changed'));
  throw new ApiError(response.status, error.message || 'No se pudo conectar al servidor');
}
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const company = companyId;
  const response = await fetch(`/api${path}`, { method, signal, credentials: 'same-origin', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(company ? { 'X-Company-Id': company } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) return responseError(response, path);
  const result = await response.json() as T;
  if (method !== 'GET') {
    if (/^\/auth\/(login|register|logout|reset|password)$/.test(path)) { queryClient.clear(); useWorkspaceStore.getState().reset(); }
    else {
      // Active forms explicitly refresh their result; all other cached views become
      // stale and refresh when mounted/focused, avoiding duplicate mutation refetches.
      void queryClient.invalidateQueries({ queryKey: [company], refetchType: 'none' });
    }
  }
  return result;
}
export async function exportData(kind: 'orders' | 'customers') {
  return downloadData(kind === 'orders' ? '/reports/export' : '/customers/export', kind === 'orders' ? 'ordenes-centimos.csv' : 'clientes.csv');
}
export async function downloadData(path: string, filename: string) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'X-Company-Id': companyId } });
  if (!response.ok) {
    return responseError(response);
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser time to consume the URL before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const currency = (cents: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(cents / 100);
export const date = (value: string) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value));
export const cents = (value: FormDataEntryValue | null) => Math.round(Number(value) * 100);
export const statusLabel: Record<string, string> = { received: 'Recibido', processing: 'En proceso', ready: 'Listo', delivered: 'Entregado', cancelled: 'Anulado' };
