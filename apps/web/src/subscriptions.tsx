import { useState } from 'react';
import { api, currency, downloadData } from './api';
import { useData } from './components/common';
import { Button } from './components/ui/button';
import { RequestForm, requestLabel } from './request-form';
export { requestLabel } from './request-form';
import { DataTable } from './components/data-table';

export interface Charge { id: string; periodStart: string; periodEnd: string; total: number; paid: number }
export interface SubscriptionInfo { cycle: string; price: number; anchor: string; coveredUntil: string; trialUntil: string | null; extensionUntil: string | null; graceDays: number; userLimit: number | null; branchLimit: number | null; plan?: string }
export interface CompanyRequest { id: string; companyId: string; company: string; kind: string; reason: string; seats: number | null; state: string; resolution?: string }
export const requestState: Record<string, string> = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };
export function SubscriptionPage() {
  const { data, error } = useData(['subscription'], signal => api<{ company: { name: string; status: string; subscribed: boolean; subscriptionDue: number }; subscription: SubscriptionInfo | null; charges: Charge[] }>('/subscription', 'GET', undefined, signal));
  const requests = useData(['requests'], signal => api<CompanyRequest[]>('/requests', 'GET', undefined, signal));
  const [kind, setKind] = useState<string>();
  const [failure, setFailure] = useState('');
  return <><div className="page-heading"><div><h1>Suscripción y solicitudes</h1><p>Gestión comercial y acceso a tus datos.</p></div></div>
    {(error || requests.error || failure) && <p className="error" role="alert">{error || requests.error || failure}</p>}
    {data && <section className="panel settings-section"><h2>{data.company.name}</h2><p>Acceso: {data.company.status === 'active' && data.company.subscribed ? 'Activo' : 'Suspendido'}</p>
      {data.subscription ? <><p>{data.subscription.plan} · {data.subscription.cycle === 'annual' ? 'Anual' : 'Mensual'} · {currency(data.subscription.price)}</p><p>Cobertura hasta: {data.subscription.coveredUntil} (fecha exclusiva). Gracia: {data.subscription.graceDays} días.</p>
        {data.subscription.extensionUntil && <p>Prórroga hasta: {data.subscription.extensionUntil}</p>}<p>Cupo de usuarios: {data.subscription.userLimit ?? 'Por configurar'}. Sedes: {data.subscription.branchLimit ?? 'Por configurar'}.</p></> : <p>Plan comercial pendiente de configuración.</p>}
      <p>Saldo SaaS: <strong>{currency(data.company.subscriptionDue)}</strong></p>
      <p>Coordina tus pagos con <a href="https://wa.me/51946561987" target="_blank" rel="noreferrer">soporte por WhatsApp</a> o <a href="mailto:ing.ryqm@gmail.com">ing.ryqm@gmail.com</a>.</p>
    </section>}
    <h2>Cuotas</h2><DataTable rows={data?.charges ?? []} label="Cuotas de suscripción" columns={[
      { accessorKey: 'periodStart', header: 'Desde' }, { accessorKey: 'periodEnd', header: 'Hasta (exclusivo)' },
      { accessorKey: 'total', header: 'Importe', cell: ({ row }) => currency(row.original.total) },
      { accessorKey: 'paid', header: 'Pagado', cell: ({ row }) => currency(row.original.paid) },
    ]}/>
    <div className="actions"><Button onClick={() => setKind('seats')}>Solicitar más usuarios</Button><Button variant="outline" onClick={() => setKind('export')}>Solicitar mis datos</Button></div>
    <DataTable rows={requests.data ?? []} label="Mis solicitudes" columns={[
      { accessorKey: 'kind', header: 'Solicitud', cell: ({ row }) => requestLabel[row.original.kind] },
      { accessorKey: 'reason', header: 'Motivo' }, { accessorKey: 'state', header: 'Estado', cell: ({ row }) => requestState[row.original.state] },
      { accessorKey: 'resolution', header: 'Respuesta' },
      { id: 'download', header: 'Datos', cell: ({ row }) => row.original.kind === 'export' && row.original.state === 'approved' && <Button variant="outline" onClick={async () => {
        try { setFailure(''); await downloadData(`/requests/${row.original.id}/export`, 'datos-lavanderia.json'); } catch (e) { setFailure((e as Error).message); }
      }}>Descargar mis datos</Button> },
    ]}/>
    {kind && <RequestForm kind={kind} close={() => setKind(undefined)} done={async () => { setKind(undefined); await requests.refresh(); }}/>}
  </>;
}
