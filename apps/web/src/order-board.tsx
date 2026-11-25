import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Order } from '@lav/shared';
import { api, companyId, currency, date } from './api';
import { Badge, Empty, useData } from './components/common';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';

const columns = [
  { status: 'received', title: 'Por hacer' },
  { status: 'processing', title: 'En proceso' },
  { status: 'ready', title: 'Listo' },
] as const;

export function OrderBoard({ open }: { open: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [delivered, setDelivered] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  return <>
    <div className="filters"><Input aria-label="Buscar orden" maxLength={120} placeholder="Buscar cliente, celular o número…" value={search} onChange={event => setSearch(event.target.value)}/></div>
    <div className="order-board">
      {columns.map(column => <OrderColumn key={`${column.status}:${query}`} {...column} search={query} open={open}/>)}
    </div>
    <details className="order-archive panel" onToggle={event => setDelivered(event.currentTarget.open)}>
      <summary>Entregados <span>Consultar historial</span></summary>
      {delivered && <OrderColumn key={`delivered:${query}`} status="delivered" title="Pedidos entregados" search={query} open={open}/>}
    </details>
    <details className="order-archive panel" onToggle={event => setCancelled(event.currentTarget.open)}>
      <summary>Anulados <span>Consultar historial</span></summary>
      {cancelled && <OrderColumn key={`cancelled:${query}`} status="cancelled" title="Pedidos anulados" search={query} open={open}/>}
    </details>
  </>;
}

function OrderColumn({ status, title, search, open }: { status: string; title: string; search: string; open: (id: string) => void }) {
  const [offset, setOffset] = useState(0);
  const { data, error, refresh } = useData(['orders', search, status, offset],
    signal => api<Order[]>(`/orders?search=${encodeURIComponent(search)}&status=${status}&offset=${offset}`, 'GET', undefined, signal));
  // If the last card moves out of a later page, show the preceding page.
  useEffect(() => {
    if (data?.length === 0 && offset > 0) setOffset(value => Math.max(0, value - 100));
  }, [data, offset]);
  return <section className={`order-column ${status}`} aria-label={title}>
    <header><h2>{title}</h2><span>{data ? `${data.length}${data.length === 100 ? '+' : ''} en esta página` : '…'}</span></header>
    {error && <div role="alert"><p className="error">{error}</p><Button variant="outline" onClick={refresh}>Reintentar</Button></div>}
    {!data && !error && <Empty text="Cargando pedidos…"/>}
    {data?.length === 0 && <Empty text={search ? 'Sin coincidencias.' : 'No hay pedidos en este estado.'}/>}
    <div className="order-cards">{data?.map(order => <OrderCard key={order.id} order={order} open={open}/>)}</div>
    {(offset > 0 || (data?.length ?? 0) >= 100) && <div className="board-pagination">
      <Button variant="outline" aria-label={`Página anterior · ${title}`} disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>Anterior</Button>
      <span>Pág. {offset / 100 + 1}</span>
      <Button variant="outline" aria-label={`Página siguiente · ${title}`} disabled={!data || data.length < 100} onClick={() => setOffset(value => value + 100)}>Siguiente</Button>
    </div>}
  </section>;
}

function OrderCard({ order, open }: { order: Order; open: (id: string) => void }) {
  const client = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = !['delivered', 'cancelled'].includes(order.status);
  const overdue = pending && new Date(order.dueAt).getTime() < Date.now();
  const number = `#${String(order.number).padStart(4, '0')}`;
  async function advance() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api(`/orders/${order.id}/status`, 'PATCH', { status: order.status === 'received' ? 'processing' : 'ready' });
      await client.invalidateQueries({ queryKey: [companyId, 'orders'] });
      await client.invalidateQueries({ queryKey: [companyId, 'order', order.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el pedido');
      // A competing operator may have changed its state.
      void client.invalidateQueries({ queryKey: [companyId, 'orders'] });
    } finally { lock.current = false; setBusy(false); }
  }
  return <article className="order-card" aria-label={`Pedido ${number}`}>
    <div className="order-card-top"><strong>{number}</strong><Badge status={order.status}/></div>
    {order.express && <p className="hint">Express · sin recargo</p>}
    {order.garmentCount != null && <p className="muted">{order.garmentCount} prendas</p>}
    <h3>{order.customerName}</h3>
    {order.phone && <p className="muted">{order.phone}</p>}
    <p className={overdue ? 'order-overdue' : 'muted'}>{overdue ? 'Entrega vencida' : 'Entrega prometida'}<br/><time dateTime={order.dueAt}>{date(order.dueAt)}</time></p>
    <dl className="order-card-money">
      <div><dt>Total</dt><dd>{currency(order.total)}</dd></div>
      <div><dt>Cobrado</dt><dd>{currency(order.paid)}</dd></div>
      <div><dt>Saldo</dt><dd>{order.status === 'cancelled' ? 'Anulado' : currency(order.total - order.paid)}</dd></div>
    </dl>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="order-card-actions">
      <Button variant="outline" onClick={() => open(order.id)} aria-label={`Ver pedido ${number}`}>Ver pedido</Button>
      {['received', 'processing'].includes(order.status) && <Button disabled={busy} onClick={() => void advance()}>{busy ? 'Actualizando…' : order.status === 'received' ? 'Iniciar lavado' : 'Marcar listo'}</Button>}
      {order.status === 'ready' && <Button onClick={() => open(order.id)}>{order.total > order.paid ? 'Cobrar y entregar' : 'Revisar entrega'}</Button>}
    </div>
  </article>;
}
