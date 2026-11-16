import { Children, cloneElement, isValidElement, useId, useEffect, useRef, useState, type ReactElement, type ReactNode, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';

export function Field({ label, children }: { label: string; children: ReactNode }) { const id = useId(); return <label className="field"><span id={id}>{label}</span>{Children.map(children, (child, index) => index === 0 && isValidElement(child) ? cloneElement(child as ReactElement<{ 'aria-labelledby'?: string }>, { 'aria-labelledby': id }) : child)}</label>; }
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
  return createPortal(<dialog ref={ref} onCancel={close} aria-label={title} className="modal"><header><h2>{title}</h2><Button variant="ghost" onClick={close} aria-label="Cerrar"><X/></Button></header>{children}</dialog>, document.body);
}
export function Form({ submit, children, label = 'Guardar', done }: { submit: (data: FormData) => Promise<unknown>; children: ReactNode; label?: string; done?: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const lock = useRef(false);
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await submit(new FormData(event.currentTarget)); done?.(); } catch (e) { setError(e instanceof Error ? e.message : 'Error inesperado'); } finally { lock.current = false; setBusy(false); }
  }
  return <form onSubmit={handle} className="form"><fieldset disabled={busy}>{children}</fieldset>{error && <p role="alert" className="error">{error}</p>}<Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin"/>}{busy ? 'Guardando…' : label}</Button></form>;
}
export function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
export function Badge({ status }: { status: string }) { const labels: Record<string, string> = { received: 'Recibido', processing: 'En proceso', ready: 'Listo', delivered: 'Entregado', cancelled: 'Anulado' }; return <span className={`badge ${status}`}>{labels[status] ?? status}</span>; }
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>(); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
  useEffect(() => { let alive = true; setError(''); load().then(value => { if (alive) setData(value); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [...deps, version]);
  return { data, error, refresh: () => setVersion(v => v + 1) };
}
