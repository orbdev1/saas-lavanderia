import { useState } from 'react';
import type { Identity, PlatformCompany } from '@lav/shared';
import { api, cents, currency, date } from './api';
import { Field, Form, Modal, useData } from './components/common';
import { DataTable } from './components/data-table';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { MFAPanel } from './accounts';
import { requestLabel, requestState, type Charge, type CompanyRequest, type SubscriptionInfo } from './subscriptions';

interface Plan { id: string; name: string; monthlyPrice: number; annualPrice: number; userLimit: number | null; branchLimit: number | null; active: boolean }
interface SaaSPayment { id: string; chargeId: string; amount: number; method: string; reference: string; paidAt: string; reversesId: string | null }
interface CompanyDetail { company: PlatformCompany; subscription: SubscriptionInfo | null; charges: Charge[]; payments: SaaSPayment[]; members: { id: string; name: string; email: string }[] }
export function PlatformConsole({ identity, reload }: { identity: Identity; reload: () => Promise<void> }) {
  if (!identity.mfaVerified) return <><h1>Administración de plataforma</h1><MFAPanel done={reload}/></>;
  return <PlatformWorkspace/>;
}
function PlatformWorkspace() {
  const companies = useData(['platform', 'companies'], signal => api<PlatformCompany[]>('/platform/companies', 'GET', undefined, signal));
  const plans = useData(['platform', 'plans'], signal => api<Plan[]>('/platform/plans', 'GET', undefined, signal));
  const finance = useData(['platform', 'finance'], signal => api<{ totals: { income: number; expenses: number; outstanding: number }; expenses: { id: string; amount: number; description: string; paidAt: string }[]; payments: { id: string; company: string; amount: number; method: string; reference: string; paidAt: string }[] }>('/platform/finance', 'GET', undefined, signal));
  const requests = useData(['platform', 'requests'], signal => api<CompanyRequest[]>('/platform/requests', 'GET', undefined, signal));
  const [company, setCompany] = useState<string>();
  const [plan, setPlan] = useState<Plan | 'new'>();
  const [expense, setExpense] = useState(false);
  const [resolve, setResolve] = useState<CompanyRequest>();
  const refresh = async () => { await Promise.all([companies.refresh(), finance.refresh(), requests.refresh()]); };
  return <><div className="page-heading"><div><h1>Administración de plataforma</h1><p>Ingresos y gastos del SaaS. Registro manual y auditado.</p></div></div>
    {[companies.error, plans.error, finance.error, requests.error].filter(Boolean).map((error, i) => <p key={i} className="error" role="alert">{error}</p>)}
    <div className="stats">{[
      ['Ingresos SaaS', finance.data?.totals.income ?? 0], ['Gastos SaaS', finance.data?.totals.expenses ?? 0],
      ['Resultado neto', (finance.data?.totals.income ?? 0) - (finance.data?.totals.expenses ?? 0)], ['Cuotas por cobrar', finance.data?.totals.outstanding ?? 0],
    ].map(([label, value]) => <article className="panel stat" key={String(label)}><span>{label}</span><strong>{currency(Number(value))}</strong></article>)}</div>
    <h2>Lavanderías</h2><DataTable label="Empresas" rows={companies.data ?? []} columns={[
      { accessorKey: 'name', header: 'Empresa' }, { accessorKey: 'status', header: 'Estado', cell: ({ row }) => row.original.status === 'active' ? 'Activa' : 'Suspendida' },
      { accessorKey: 'subscriptionDue', header: 'Saldo SaaS', cell: ({ row }) => currency(row.original.subscriptionDue) },
      { id: 'manage', header: 'Administrar', cell: ({ row }) => <Button variant="outline" onClick={() => setCompany(row.original.id)}>Ver empresa</Button> },
    ]}/>
    <div className="line-heading"><h2>Planes configurables</h2><Button onClick={() => setPlan('new')}>Crear plan</Button></div>
    <p className="muted">No hay precios ni cupos predefinidos. Cambiar un plan no modifica cuotas ya emitidas ni contratos existentes.</p>
    <DataTable label="Planes" rows={plans.data ?? []} columns={[
      { accessorKey: 'name', header: 'Plan' }, { accessorKey: 'monthlyPrice', header: 'Mensual', cell: ({ row }) => currency(row.original.monthlyPrice) },
      { accessorKey: 'annualPrice', header: 'Anual', cell: ({ row }) => currency(row.original.annualPrice) },
      { accessorKey: 'userLimit', header: 'Usuarios', cell: ({ row }) => row.original.userLimit ?? 'Sin configurar' },
      { id: 'edit', header: 'Acciones', cell: ({ row }) => <Button variant="outline" onClick={() => setPlan(row.original)}>Editar plan</Button> },
    ]}/>
    <div className="line-heading"><h2>Gastos</h2><Button onClick={() => setExpense(true)}>Registrar gasto</Button></div>
    <DataTable rows={finance.data?.expenses ?? []} label="Gastos SaaS" columns={[
      { accessorKey: 'description', header: 'Concepto' }, { accessorKey: 'amount', header: 'Importe', cell: ({ row }) => currency(row.original.amount) },
      { accessorKey: 'paidAt', header: 'Fecha', cell: ({ row }) => date(row.original.paidAt) },
    ]}/>
    <h2>Ingresos y reversiones</h2><DataTable rows={finance.data?.payments ?? []} label="Ingresos SaaS" columns={[
      { accessorKey: 'company', header: 'Empresa' }, { accessorKey: 'amount', header: 'Importe', cell: ({ row }) => currency(row.original.amount) },
      { accessorKey: 'method', header: 'Medio' }, { accessorKey: 'reference', header: 'Referencia' },
      { accessorKey: 'paidAt', header: 'Fecha', cell: ({ row }) => date(row.original.paidAt) },
    ]}/>
    <h2>Solicitudes</h2><DataTable label="Solicitudes de empresas" rows={requests.data ?? []} columns={[
      { accessorKey: 'company', header: 'Empresa' }, { accessorKey: 'kind', header: 'Tipo', cell: ({ row }) => requestLabel[row.original.kind] },
      { accessorKey: 'reason', header: 'Motivo' }, { accessorKey: 'state', header: 'Estado', cell: ({ row }) => requestState[row.original.state] },
      { id: 'resolve', header: 'Resolver', cell: ({ row }) => row.original.state === 'pending' && <Button variant="outline" onClick={() => setResolve(row.original)}>Revisar</Button> },
    ]}/>
    {company && <CompanyBilling id={company} plans={plans.data ?? []} close={() => { setCompany(undefined); void refresh(); }}/>}
    {plan && <PlanForm plan={plan === 'new' ? undefined : plan} close={() => setPlan(undefined)} done={async () => { setPlan(undefined); await plans.refresh(); }}/>}
    {expense && <ExpenseForm close={() => setExpense(false)} done={async () => { setExpense(false); await finance.refresh(); }}/>}
    {resolve && <Modal title="Resolver solicitud" close={() => setResolve(undefined)}><Form submit={async form => {
      await api(`/platform/requests/${resolve.id}/resolve`, 'POST', { approve: form.get('decision') === 'approve', reason: form.get('reason') }); setResolve(undefined); await refresh();
    }}><p>{resolve.company}: {resolve.reason}{resolve.seats ? ` · ${resolve.seats} usuarios adicionales` : ''}</p><Field label="Decisión"><select name="decision"><option value="reject">Rechazar</option><option value="approve">Aprobar</option></select></Field><Reason/></Form></Modal>}
  </>;
}
function Reason() { return <Field label="Motivo / sustento"><textarea name="reason" required minLength={5} maxLength={500}/></Field>; }
function Money({ label, name, value }: { label: string; name: string; value?: number }) { return <Field label={label}><Input name={name} type="number" min=".01" max="1000000" step=".01" required defaultValue={value === undefined ? undefined : value / 100}/></Field>; }
function Method() { return <Field label="Medio"><select name="method"><option value="transfer">Transferencia</option><option value="yape">Yape</option><option value="plin">Plin</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option></select></Field>; }
const optionalNumber = (form: FormData, key: string) => form.get(key) ? Number(form.get(key)) : null;
function PlanForm({ plan, close, done }: { plan?: Plan; close: () => void; done: () => Promise<void> }) {
  return <Modal title={plan ? 'Editar plan' : 'Crear plan'} close={close}><Form submit={async form => {
    await api(`/platform/plans${plan ? `/${plan.id}` : ''}`, plan ? 'PUT' : 'POST', { name: form.get('name'), monthlyPrice: cents(form.get('monthlyPrice')), annualPrice: cents(form.get('annualPrice')), userLimit: optionalNumber(form, 'userLimit'), branchLimit: optionalNumber(form, 'branchLimit'), active: form.get('active') === 'on', reason: form.get('reason') }); await done();
  }}><Field label="Nombre del plan"><Input name="name" defaultValue={plan?.name} required minLength={2}/></Field>
    <Money label="Mensualidad (S/)" name="monthlyPrice" value={plan?.monthlyPrice}/><Money label="Anualidad (S/)" name="annualPrice" value={plan?.annualPrice}/>
    <Field label="Cupo de usuarios (opcional)"><Input name="userLimit" type="number" min={1} defaultValue={plan?.userLimit ?? ''}/></Field>
    <Field label="Cupo de sedes (opcional)"><Input name="branchLimit" type="number" min={1} defaultValue={plan?.branchLimit ?? ''}/></Field>
    <label className="check"><input type="checkbox" name="active" defaultChecked={plan?.active ?? true}/>Plan activo</label><Reason/>
  </Form></Modal>;
}
function ExpenseForm({ close, done }: { close: () => void; done: () => Promise<void> }) {
  const [requestId] = useState(() => crypto.randomUUID());
  return <Modal title="Registrar gasto SaaS" close={close}><Form submit={async form => {
    await api('/platform/expenses', 'POST', { amount: cents(form.get('amount')), description: form.get('description'), paidAt: new Date(`${form.get('paidAt')}T12:00:00-05:00`).toISOString(), requestId }); await done();
  }}><Money label="Importe (S/)" name="amount"/><Field label="Concepto"><textarea name="description" required minLength={5}/></Field><Field label="Fecha del gasto"><Input name="paidAt" type="date" required/></Field></Form></Modal>;
}
function CompanyBilling({ id, plans, close }: { id: string; plans: Plan[]; close: () => void }) {
  const { data, error, refresh } = useData(['platform', 'company', id], signal => api<CompanyDetail>(`/platform/companies/${id}`, 'GET', undefined, signal));
  const [action, setAction] = useState<string>();
  const [entity, setEntity] = useState('');
  const [recovery, setRecovery] = useState('');
  return <Modal title={data?.company.name ?? 'Cargando empresa…'} close={close}>
    {error && <p className="error">{error}</p>}{data && <>
      <p>Saldo SaaS: {currency(data.company.subscriptionDue)}</p>
      <p>{data.subscription ? `${data.subscription.cycle === 'annual' ? 'Anual' : 'Mensual'} · ${currency(data.subscription.price)} · Cubierto hasta ${data.subscription.coveredUntil}` : 'Suscripción por configurar'}</p>
      <div className="actions">{[['configure', 'Configurar suscripción'], ['charge', 'Generar cuota'], ['extension', 'Dar prórroga'], ['status', 'Cambiar estado']].map(([key, label]) => <Button key={key} variant="outline" onClick={() => setAction(key)}>{label}</Button>)}</div>
      <DataTable label="Cuotas de la empresa" rows={data.charges} columns={[
        { accessorKey: 'periodStart', header: 'Desde' }, { accessorKey: 'periodEnd', header: 'Hasta' },
        { id: 'balance', header: 'Saldo', cell: ({ row }) => currency(row.original.total - row.original.paid) },
        { id: 'pay', header: 'Cobro', cell: ({ row }) => row.original.total > row.original.paid && <Button variant="outline" onClick={() => { setEntity(row.original.id); setAction('payment'); }}>Registrar pago SaaS</Button> },
      ]}/>
      <DataTable label="Pagos de la empresa" rows={data.payments} columns={[
        { accessorKey: 'amount', header: 'Importe', cell: ({ row }) => currency(row.original.amount) }, { accessorKey: 'reference', header: 'Referencia' },
        { id: 'reverse', header: 'Corrección', cell: ({ row }) => row.original.amount > 0 && !data.payments.some(p => p.reversesId === row.original.id) && <Button variant="outline" onClick={() => { setEntity(row.original.id); setAction('reverse'); }}>Revertir pago</Button> },
      ]}/>
      <h3>Recuperación asistida de personas</h3>{data.members.map(member => <div className="actions" key={member.id}><span>{member.name} · {member.email}</span><Button variant="outline" onClick={() => { setEntity(member.id); setAction('recovery'); }}>Generar enlace manual</Button></div>)}
      {recovery && <p role="status" className="hint">Entrega privada, vigencia 30 minutos: <a href={recovery}>{recovery}</a></p>}
      {action && <BillingAction key={`${action}:${entity}`} action={action} entity={entity} id={id} data={data} plans={plans} close={() => setAction(undefined)} done={async result => { if (result?.url) setRecovery(result.url); setAction(undefined); await refresh(); }}/>}
    </>}
  </Modal>;
}
function BillingAction({ action, entity, id, data, plans, close, done }: { action: string; entity: string; id: string; data: CompanyDetail; plans: Plan[]; close: () => void; done: (value?: { url?: string }) => Promise<void> }) {
  const [requestId] = useState(() => crypto.randomUUID());
  return <Modal title={{ configure: 'Configurar suscripción', charge: 'Generar siguiente cuota', extension: 'Prórroga auditada', status: 'Estado de la empresa', payment: 'Registrar pago SaaS', reverse: 'Revertir pago SaaS', recovery: 'Recuperación asistida' }[action] ?? 'Administrar'} close={close}>
    <Form submit={async form => {
      const base = `/platform/companies/${id}`, reason = form.get('reason');
      let path = '', method = 'POST', payload: object = {};
      if (action === 'configure') { path = `${base}/subscription`; method = 'PUT'; payload = { planId: form.get('planId'), cycle: form.get('cycle'), anchor: form.get('anchor'), trialUntil: form.get('trialUntil') || null, reason }; }
      if (action === 'charge') { path = `${base}/charges`; payload = { requestId, reason }; }
      if (action === 'extension') { path = `${base}/extension`; payload = { until: form.get('until'), reason }; }
      if (action === 'status') { path = base; method = 'PATCH'; payload = { status: form.get('status'), reason }; }
      if (action === 'payment') { path = `${base}/payments`; payload = { chargeId: entity, amount: cents(form.get('amount')), method: form.get('method'), reference: form.get('reference'), paidAt: new Date(`${form.get('paidAt')}T12:00:00-05:00`).toISOString(), reason, requestId }; }
      if (action === 'reverse') { path = `${base}/reverse-payment`; payload = { paymentId: entity, reason, requestId }; }
      if (action === 'recovery') { path = `/platform/users/${entity}/recovery`; payload = { reason }; }
      await done(await api(path, method, payload));
    }}>
      {action === 'configure' && <><Field label="Plan"><select name="planId" required>{plans.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Ciclo"><select name="cycle" defaultValue={data.subscription?.cycle}><option value="monthly">Mensual</option><option value="annual">Anual</option></select></Field>
        <Field label="Fecha ancla original"><Input name="anchor" type="date" required readOnly={Boolean(data.subscription)} defaultValue={data.subscription?.anchor}/></Field>
        <Field label="Prueba hasta (opcional)"><Input name="trialUntil" type="date" defaultValue={data.subscription?.trialUntil ?? ''}/></Field></>}
      {action === 'extension' && <Field label="Prórroga hasta (fecha exclusiva)"><Input type="date" name="until" required/></Field>}
      {action === 'status' && <Field label="Estado administrativo"><select name="status" defaultValue={data.company.status}><option value="active">Activa</option><option value="suspended">Suspendida</option></select></Field>}
      {action === 'payment' && <><Money label="Importe recibido (S/)" name="amount" value={data.charges.find(c => c.id === entity) ? data.charges.find(c => c.id === entity)!.total - data.charges.find(c => c.id === entity)!.paid : undefined}/><Method/><Field label="Referencia / constancia"><Input name="reference" required maxLength={120}/></Field><Field label="Fecha de pago"><Input name="paidAt" type="date" required/></Field></>}
      {action === 'charge' && <p>Se emitirá la siguiente cuota con el precio y ciclo configurados, conservando el día ancla.</p>}
      {action === 'reverse' && <p>Se registrará un movimiento contrario y se recalculará la cobertura. El pago original se conserva.</p>}
      {action === 'recovery' && <p>Verifica la identidad por contacto manual. Este enlace no elimina el segundo factor.</p>}
      <Reason/>
    </Form>
  </Modal>;
}
