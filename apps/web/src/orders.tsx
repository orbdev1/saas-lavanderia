import { useState } from 'react';
import { Plus, Trash2, Printer, MessageCircle, ArrowRight } from 'lucide-react';
import { priceLine, methods, buildWhatsAppNotice, whatsAppPhone, type WhatsAppNotice, type Order, type OrderDetail, type Customer, type Service } from '@lav/shared';
import { api, currency, date, cents, statusLabel } from './api';
import { Badge, Empty, Field, Form, Modal, useData } from './components/common';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { AddOrderServices } from './order-add-services';
import { OrderBoard } from './order-board';
import { queryClient } from './query-client';
import { companyId } from './api';
import { CustomerPicker } from './customer-picker';
import { receptionInput } from '@lav/shared';
import { useWorkspaceStore } from './workspace-store';
import { RequestForm } from './request-form';

const localDate = (value: string) => new Date(new Date(value).getTime() - 5 * 3600000).toISOString().slice(0, 16);
const limaISO = (value: FormDataEntryValue | null) => new Date(`${value}-05:00`).toISOString();
export function NewOrder({ close, created, manage }: { close: () => void; created: (id: string) => void; manage: boolean }) {
  const [customer, setCustomer] = useState<Customer>();
  const catalog = useData(['services'], signal => api<Service[]>('/services', 'GET', undefined, signal));
  const error = catalog.error;
  const [items, setItems] = useState([{ serviceId: '', quantity: '1', notes: '' }]); const [requestId] = useState(() => crypto.randomUUID());
  const [discount, setDiscount] = useState('0');
  const services = catalog.data?.filter(s => s.active) ?? [];
  const [dueAt, setDueAt] = useState(() => localDate(new Date(Date.now() + 86400000).toISOString()));
  const grouped = new Map<string, number>(); items.forEach(i => grouped.set(i.serviceId, (grouped.get(i.serviceId) ?? 0) + Number(i.quantity)));
  const total = [...grouped].reduce((sum, [id, qty]) => { const s = services.find(s => s.id === id); return sum + (s ? priceLine(qty, s.minimum, s.price).total : 0); }, 0);
  function change(index: number, value: Partial<typeof items[number]>) { setItems(items.map((item, i) => i === index ? { ...item, ...value } : item)); }
  return <Modal title="Recibir nuevo pedido" close={close}>{error && <p className="error">{error}</p>}<Form label="Crear orden" submit={async data => {
    if (!customer) throw new Error('Selecciona o crea un cliente para continuar.');
    const payload = receptionInput.safeParse({ customerId: customer.id, dueAt: limaISO(data.get('dueAt')), notes: data.get('notes'), items: items.map(item => ({ ...item, quantity: Number(item.quantity) })), requestId,
      discount: manage ? Math.round(Number(discount) * 100) : 0, express: data.get('express') === 'on', garmentCount: data.get('garmentCount') ? Number(data.get('garmentCount')) : null });
    if (!payload.success) throw new Error('Revisa cantidades, notas y datos del pedido.');
    const result = await api<{ id: string }>('/orders', 'POST', payload.data); created(result.id);
  }}><CustomerPicker value={customer} select={setCustomer}/><Field label="Entrega prometida"><Input type="datetime-local" name="dueAt" required value={dueAt} onChange={event => setDueAt(event.target.value)}/></Field>
    <div className="quick-options" role="group" aria-label="Entrega rápida">{[1, 2, 3].map(days => <Button key={days} type="button" variant="outline" onClick={() => { const next = new Date(); next.setDate(next.getDate() + days); setDueAt(localDate(next.toISOString())); }}>{days === 1 ? 'Mañana' : `En ${days} días`}</Button>)}</div>
    <div className="reception-services">{(['kg', 'piece'] as const).map(unit => <section key={unit}><h3>{unit === 'kg' ? 'Por kilo' : 'Por pieza'}</h3><div>{services.filter(service => service.unit === unit).map(service => <Button type="button" key={service.id} variant="outline" onClick={() => {
      const blank = items.findIndex(item => !item.serviceId);
      if (blank >= 0) change(blank, { serviceId: service.id });
      else if (items.length < 50) setItems([...items, { serviceId: service.id, quantity: '1', notes: '' }]);
    }}><span>{service.name}<small>{currency(service.price)} / {unit === 'kg' ? 'kg' : 'pieza'}</small></span></Button>)}</div></section>)}</div>
    <div className="line-heading"><strong>Servicios recibidos</strong><Button type="button" variant="ghost" disabled={items.length >= 50} onClick={() => setItems([...items, { serviceId: '', quantity: '1', notes: '' }])}><Plus/>Agregar</Button></div>
    {items.map((item, index) => { const piece = services.find(s => s.id === item.serviceId)?.unit === 'piece'; return <section key={index}>
      <div className="order-line"><Field label="Servicio"><select required value={item.serviceId} onChange={e => change(index, { serviceId: e.target.value })}><option value="" disabled>Seleccionar</option>{services.map(s => <option key={s.id} value={s.id}>{s.name} · {currency(s.price)}/{s.unit === 'kg' ? 'kg' : 'pieza'}</option>)}</select></Field>
      <Field label="Kg / piezas reales"><Input required type="number" inputMode={piece ? 'numeric' : 'decimal'} min={piece ? '1' : '0.01'} step={piece ? '1' : '0.01'} max="10000" value={item.quantity} onChange={e => change(index, { quantity: e.target.value })}/><small>{piece ? 'Solo piezas enteras.' : 'Máximo dos decimales.'}</small></Field>
      <Button type="button" variant="ghost" disabled={items.length === 1} aria-label="Quitar servicio" onClick={() => setItems(items.filter((_, i) => i !== index))}><Trash2/></Button></div>
      <div className="quick-options" role="group" aria-label={`Cantidades rápidas del servicio ${index + 1}`}>{[1, 2, 3, 5].map(value => <Button type="button" variant="outline" key={value} onClick={() => change(index, { quantity: String(value) })}>{value} {piece ? 'ud.' : 'kg'}</Button>)}</div>
      <Field label={`Notas del servicio ${index + 1}`}><Input value={item.notes} maxLength={500} onChange={event => change(index, { notes: event.target.value })} placeholder="Manchas, color, cuidados…"/></Field>
    </section>; })}
    <p className="hint">El mínimo se aplica una vez a la suma de kilos de cada servicio.</p><Field label="Notas / prendas / cuidados"><textarea name="notes" maxLength={2000}/></Field>
    <div className="two-cols"><Field label="Número de prendas (opcional)"><Input name="garmentCount" type="number" min={0} max={10000} step={1}/></Field>
    {manage && <Field label="Descuento autorizado (S/)"><Input type="number" min={0} step=".01" max={Math.max(0, (total - 1) / 100)} value={discount} onChange={event => setDiscount(event.target.value)}/></Field>}</div>
    <label className="check"><input name="express" type="checkbox"/>Express · sin recargo</label>
    <div className="total-row"><span>Total estimado</span><strong>{currency(total - (manage ? Math.round(Number(discount || 0) * 100) : 0))}</strong></div><p className="muted">Después de crear la orden podrás registrar un anticipo. Redondeo comercial desactivado.</p>
  </Form></Modal>;
}
export function Orders({ manage, companyName }: { manage: boolean; companyName: string }) {
  const view = useWorkspaceStore(state => state.orderView);
  const setView = useWorkspaceStore(state => state.setOrderView);
  const [newOrder, setNewOrder] = useState(false);
  const [selected, setSelected] = useState<string>();
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: [companyId, 'orders'] }); };
  return <>
    <div className="order-view-switch" role="group" aria-label="Vista de pedidos">
      <Button variant={view === 'board' ? 'default' : 'outline'} aria-pressed={view === 'board'} onClick={() => setView('board')}>Tablero</Button>
      <Button variant={view === 'list' ? 'default' : 'outline'} aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista</Button>
    </div>
    {view === 'list' ? <OrderList manage={manage} companyName={companyName}/> : <>
      <div className="page-heading"><div><h1>Órdenes de servicio</h1><p>Por hacer, en proceso y listas para entregar.</p></div><Button onClick={() => setNewOrder(true)}><Plus/>Recibir pedido</Button></div>
      <OrderBoard open={setSelected}/>
      {newOrder && <NewOrder manage={manage} close={() => setNewOrder(false)} created={id => { setNewOrder(false); setSelected(id); refresh(); }}/>}
      {selected && <OrderView id={selected} manage={manage} companyName={companyName} close={() => { setSelected(undefined); refresh(); }}/>}
    </>}
  </>;
}
function OrderList({ manage, companyName }: { manage: boolean; companyName: string }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [offset, setOffset] = useState(0);
  const { data, error, refresh } = useData(['orders', search, status, offset], signal => api<Order[]>(`/orders?search=${encodeURIComponent(search)}&status=${status}&offset=${offset}`, 'GET', undefined, signal));
  const [newOrder, setNewOrder] = useState(false); const [selected, setSelected] = useState<string>();
  return <><div className="page-heading"><div><h1>Órdenes de servicio</h1><p>Del mostrador a la entrega, sin perder el hilo.</p></div><Button onClick={() => setNewOrder(true)}><Plus/>Recibir pedido</Button></div><div className="filters"><Input aria-label="Buscar orden" placeholder="Buscar cliente, celular o número…" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }}/><select aria-label="Filtrar estado" value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="all">Todos los estados</option>{Object.entries(statusLabel).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></div>{error && <p className="error" role="alert">{error}</p>}
  <div className="panel table-wrap"><table><thead><tr><th>Orden / cliente</th><th>Entrega prometida</th><th>Estado</th><th>Total</th><th>Saldo</th><th/></tr></thead><tbody>{data?.map(o => <tr key={o.id}><td><strong>#{String(o.number).padStart(4, '0')}</strong><span className="cell-sub">{o.customerName}</span></td><td>{date(o.dueAt)}</td><td><Badge status={o.status}/></td><td>{currency(o.total)}</td><td className={o.total > o.paid && o.status !== 'cancelled' ? 'balance' : ''}>{o.status === 'cancelled' ? '—' : currency(o.total - o.paid)}</td><td><Button variant="ghost" onClick={() => setSelected(o.id)}>Ver<ArrowRight/></Button></td></tr>)}</tbody></table>{!data && !error && <Empty text="Cargando órdenes…"/>}{data?.length === 0 && <Empty text="No hay órdenes con estos filtros. Recibe tu primer pedido."/>}</div><div className="pagination"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Anterior</Button><span>{offset + 1}–{offset + (data?.length ?? 0)}</span><Button variant="outline" disabled={(data?.length ?? 0) < 100} onClick={() => setOffset(offset + 100)}>Siguiente</Button></div>
  {newOrder && <NewOrder manage={manage} close={() => setNewOrder(false)} created={id => { setNewOrder(false); setSelected(id); refresh(); }}/>}
  {selected && <OrderView id={selected} manage={manage} companyName={companyName} close={() => { setSelected(undefined); refresh(); }}/>}</>;
}
function OrderView({ id, manage, companyName, close }: { id: string; manage: boolean; companyName: string; close: () => void }) {
  const { data: order, error, refresh } = useData(['order', id], signal => api<OrderDetail>(`/orders/${id}`, 'GET', undefined, signal));
  const [action, setAction] = useState(''); const [actionError, setActionError] = useState(''); const [busy, setBusy] = useState(false); const [bag, setBag] = useState(false);
  const [notice, setNotice] = useState<{ phone: string; text: string; trigger: HTMLButtonElement }>();
  async function prepareNotice(kind: WhatsAppNotice, trigger: HTMLButtonElement) {
    setBusy(true);
    setActionError('');
    try {
      // Re-fetch: another operator may have registered a payment since opening the order.
      const latest = await api<OrderDetail>(`/orders/${id}`);
      queryClient.setQueryData([companyId, 'order', id], latest);
      const phone = whatsAppPhone(latest.phone);
      if (!phone) throw new Error('Completa o corrige el celular del cliente en Clientes antes de abrir WhatsApp.');
      setNotice({ phone, text: buildWhatsAppNotice(latest, companyName, kind), trigger });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'No se pudo preparar el mensaje');
    } finally {
      setBusy(false);
    }
  }
  async function advance(status: string) { setBusy(true); setActionError(''); try { await api(`/orders/${id}/status`, 'PATCH', { status }); await refresh(); } catch (e) { setActionError((e as Error).message); } finally { setBusy(false); } }
  const next: Record<string, string> = { received: 'processing', processing: 'ready', ready: 'delivered' };
  const nextLabel: Record<string, string> = { received: 'Iniciar lavado', processing: 'Marcar listo', ready: 'Entregar pedido' };
  return <Modal title={order ? `Orden #${String(order.number).padStart(4, '0')}` : 'Cargando orden…'} close={close}>{error && <p className="error">{error}</p>}{order && <><section className={`ticket ${bag ? 'bag-ticket' : ''}`}><div className="print-only"><h2>{companyName}</h2><h1>Orden #{String(order.number).padStart(4, '0')}</h1><p>{bag ? 'Identificación de bolsa' : 'Ticket de servicio · No es comprobante fiscal'}</p></div><div className="detail-top"><div><h2>{order.customerName}</h2><p>{order.phone}</p></div><Badge status={order.status}/></div><p><strong>Entrega:</strong> {date(order.dueAt)}</p><div className="ticket-lines"><table><thead><tr><th>Servicio</th><th>Real</th><th>Cobrado</th><th>Importe</th></tr></thead><tbody>{order.items.map((item, i) => <tr key={i}><td>{item.name}</td><td>{Number(item.actual)} {item.unit === 'kg' ? 'kg' : 'ud.'}</td><td>{Number(item.charged)}</td><td>{currency(item.total)}</td></tr>)}</tbody></table><div className="totals"><p>Total <strong>{currency(order.total)}</strong></p><p>Pagado <strong>{currency(order.paid)}</strong></p><p className="total-row">Saldo <strong>{order.status === 'cancelled' ? 'Anulado' : currency(order.total - order.paid)}</strong></p></div></div>{order.notes && <p className="notes">{order.notes}</p>}<div className="print-only">Conserva este ticket para recoger tu pedido.</div></section>
    <section className="reception-summary">
      {order.express && <p><strong>Express · sin recargo</strong></p>}
      {order.garmentCount != null && <p>Prendas recibidas: {order.garmentCount}</p>}
      {Boolean(order.discount) && <p>Subtotal: {currency(order.subtotal ?? order.total + (order.discount ?? 0))} · Descuento: {currency(order.discount ?? 0)}</p>}
      {order.items.filter(item => item.notes).map(item => <p key={item.serviceId}><strong>{item.name}:</strong> {item.notes}</p>)}
    </section>
    <div className="no-print"><div className="actions"><Button variant="outline" onClick={() => { setBag(false); requestAnimationFrame(() => window.print()); }}><Printer/>Ticket</Button><Button variant="outline" onClick={() => { setBag(true); requestAnimationFrame(() => window.print()); }}><Printer/>Bolsa</Button>{['received', 'processing'].includes(order.status) && <Button variant="outline" disabled={busy} onClick={event => void prepareNotice('received', event.currentTarget)}><MessageCircle/>Avisar recepción por WhatsApp</Button>}{order.status === 'ready' && <Button variant="outline" disabled={busy} onClick={event => void prepareNotice('ready', event.currentTarget)}><MessageCircle/>Avisar que está listo por WhatsApp</Button>}</div>
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {!['cancelled', 'delivered'].includes(order.status) && <><div className="actions">{order.total > order.paid && <Button onClick={() => setAction('payment')}>Registrar pago</Button>}<Button variant="outline" disabled={busy || (order.status === 'ready' && order.paid !== order.total)} onClick={() => advance(next[order.status])}>{nextLabel[order.status]}</Button></div>{order.status === 'ready' && order.paid < order.total && <p className="hint">Para entregar, cobra primero el saldo pendiente.</p>}{manage && <div className="actions"><Button variant="ghost" onClick={() => setAction('correct')}>Corregir fecha / notas</Button>{order.paid > 0 && <Button variant="ghost" onClick={() => setAction('refund')}>Devolver abono</Button>}<Button variant="ghost" disabled={order.paid !== 0} onClick={() => setAction('cancel')}>Anular orden</Button></div>}</>}
    <h3>Movimientos de pago</h3>{order.payments.length === 0 ? <Empty text="Todavía no se registraron pagos."/> : <ul className="movements">{order.payments.map(p => <li key={p.id}><div><strong>{p.amount < 0 ? 'Devolución' : 'Pago'} · {p.method.toUpperCase()}</strong><span>{date(p.createdAt)} {p.reference} {p.reason}</span></div><strong>{currency(p.amount)}</strong></li>)}</ul>}</div>
    {!['cancelled', 'delivered'].includes(order.status) && <div className="actions no-print"><Button variant="outline" disabled={busy} onClick={() => setAction('add-services')}><Plus/>Agregar servicio al pedido</Button></div>}
    {!manage && !['delivered', 'cancelled'].includes(order.status) && <Button className="no-print" variant="outline" onClick={() => setAction('request-cancel')}>Solicitar anulación</Button>}
    {action === 'request-cancel' ? <RequestForm kind="cancel" orderId={order.id} close={() => setAction('')} done={() => setAction('')}/> : action === 'add-services' ? <AddOrderServices order={order} done={() => { setAction(''); refresh(); }} close={() => { setAction(''); refresh(); }}/> : action && <ActionForm key={action} action={action} order={order} done={() => { setAction(''); refresh(); }} close={() => setAction('')}/>}
    {notice && <Modal title="Revisar aviso de WhatsApp" close={() => setNotice(undefined)} returnFocusTo={notice.trigger}>
      <Field label="Mensaje para el cliente"><textarea className="message-preview" value={notice.text} onChange={e => setNotice({ ...notice, text: e.target.value })}/></Field>
      <p className="hint">Se abrirá la cuenta de WhatsApp conectada en este dispositivo. Revisa el mensaje y pulsa Enviar allí. Abrir WhatsApp no confirma su envío ni entrega.</p>
      {notice.text.trim() ? <Button asChild><a target="_blank" rel="noopener noreferrer" href={`https://wa.me/${notice.phone}?text=${encodeURIComponent(notice.text)}`}><MessageCircle/>Abrir WhatsApp</a></Button> : <p className="error" role="alert">Escribe el mensaje antes de continuar.</p>}
    </Modal>}
  </>}</Modal>;
}
function ActionForm({ action, order, done, close }: { action: string; order: OrderDetail; done: () => void; close: () => void }) {
  const [requestId] = useState(crypto.randomUUID());
  const titles: Record<string, string> = { payment: 'Registrar pago', refund: 'Devolver abono', cancel: 'Anular orden', correct: 'Corregir datos' };
  return <Modal title={titles[action]} close={close}><Form label={titles[action]} done={done} submit={data => {
    const base = `/orders/${order.id}`;
    if (action === 'correct') return api(base, 'PATCH', { dueAt: limaISO(data.get('dueAt')), notes: data.get('notes'), reason: data.get('reason') });
    if (action === 'cancel') return api(`${base}/cancel`, 'POST', { reason: data.get('reason') });
    return api(`${base}/${action === 'refund' ? 'refunds' : 'payments'}`, 'POST', { amount: cents(data.get('amount')), method: data.get('method'), ...(action === 'refund' ? { reason: data.get('reason') } : { reference: data.get('reference') }), requestId });
  }}>
    {['payment', 'refund'].includes(action) && <><Field label="Importe (S/)"><Input name="amount" type="number" min="0.01" step="0.01" max={(action === 'refund' ? order.paid : order.total - order.paid) / 100} defaultValue={(action === 'refund' ? order.paid : order.total - order.paid) / 100} required/></Field><Field label="Medio de pago"><select name="method">{methods.map(m => <option key={m} value={m}>{m === 'cash' ? 'Efectivo' : m.toUpperCase()}</option>)}</select></Field>{action === 'payment' && <Field label="Referencia / operación (opcional)"><Input name="reference" maxLength={120}/></Field>}<p className="hint">Efectivo requiere una caja abierta. Yape y Plin se registran manualmente.</p></>}
    {action === 'correct' && <><Field label="Nueva entrega prometida"><Input name="dueAt" type="datetime-local" required defaultValue={localDate(order.dueAt)}/></Field><Field label="Notas"><textarea name="notes" defaultValue={order.notes}/></Field></>}
    {action !== 'payment' && <Field label="Motivo (queda en auditoría)"><textarea name="reason" required minLength={5} maxLength={500}/></Field>}
    {action === 'cancel' && <p className="hint">La orden quedará anulada y se conservará su historial. Para agregar trabajo, usa «Agregar servicio al pedido». Las reducciones de servicios o importes requieren una corrección autorizada.</p>}
  </Form></Modal>;
}
