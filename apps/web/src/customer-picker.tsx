import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Customer } from '@lav/shared';
import { api, companyId } from './api';
import { Field, Form, Modal } from './components/common';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';

export function CustomerPicker({ value, select }: { value?: Customer; select: (customer?: Customer) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const result = useQuery({
    queryKey: [companyId, 'customers', 'search', term],
    queryFn: ({ signal }) => api<Customer[]>(`/customers?search=${encodeURIComponent(term)}`, 'GET', undefined, signal),
    enabled: !value && term.length >= 2,
  });
  const matches = search.trim() === term ? result.data ?? [] : [];
  const visible = expanded && !value && search.trim().length >= 2;
  function choose(customer: Customer) {
    select(customer); setExpanded(false); setActive(-1);
  }
  return <div className="customer-picker">
    {value ? <div className="selected-customer"><div><strong>{value.name}</strong><p>{value.phone || 'Sin celular'}{value.document ? ` · ${value.document}` : ''}</p></div>
      <Button type="button" variant="outline" onClick={() => { select(undefined); setSearch(''); setTerm(''); setActive(-1); }}>Cambiar cliente</Button></div> : <>
      <Field label="Cliente · buscar por nombre o celular">
        <Input ref={input} role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={`${id}-options`}
          aria-activedescendant={visible && active >= 0 && matches[active] ? `${id}-${active}` : undefined}
          autoComplete="off" maxLength={120} placeholder="Escribe al menos 2 caracteres…" value={search}
          onFocus={() => setExpanded(true)}
          onBlur={event => { if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget)) setExpanded(false); }}
          onChange={event => { setSearch(event.target.value); setExpanded(true); setActive(-1); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setExpanded(true);
              if (matches.length) setActive(index => event.key === 'ArrowDown' ? (index + 1) % matches.length : (index <= 0 ? matches.length : index) - 1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (visible && matches[active]) choose(matches[active]);
            } else if (event.key === 'Escape' && expanded) {
              event.preventDefault(); event.stopPropagation(); setExpanded(false);
            }
          }}/>
      </Field>
      {visible && <div className="customer-results">
        <ul id={`${id}-options`} role="listbox" aria-label="Clientes encontrados">
          {matches.map((customer, index) => <li key={customer.id} id={`${id}-${index}`} role="option" aria-selected={active === index}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(customer)}>
            <strong>{customer.name}</strong><span>{customer.phone || 'Sin celular'}{customer.document ? ` · ${customer.document}` : ''}</span>
          </li>)}
        </ul>
        <p role="status" className="muted">{result.isFetching || search.trim() !== term ? 'Buscando clientes…' : result.isError ? 'No se pudo buscar. Reintenta.' : matches.length ? `${matches.length} coincidencias${matches.length === 30 ? '; escribe más para precisar' : ''}. Selecciona una persona.` : 'Sin coincidencias. Puedes crear el cliente aquí.'}</p>
        {result.isError && <Button type="button" variant="outline" onClick={() => void result.refetch()}>Reintentar búsqueda</Button>}
      </div>}
      <Button type="button" variant="outline" onClick={() => setCreating(true)}>Crear cliente aquí</Button>
      <p className="muted">El celular es opcional y puede compartirse. Selecciona a la persona correcta.</p>
    </>}
    {creating && <Modal title="Crear cliente para este pedido" close={() => setCreating(false)}>
      <Form label="Guardar y seleccionar cliente" submit={async data => {
        const customer = await api<Customer>('/customers', 'POST', Object.fromEntries(data));
        choose(customer); setCreating(false);
      }}>
        <Field label="Nombre completo"><Input name="name" required minLength={2} maxLength={120} defaultValue={/[a-záéíóúñ]/i.test(search) ? search : ''}/></Field>
        <Field label="Celular (opcional)"><Input name="phone" type="tel" maxLength={20} defaultValue={/^\+?[0-9 ()-]+$/.test(search) ? search : ''}/></Field>
        <Field label="DNI / RUC (opcional)"><Input name="document" maxLength={20}/></Field>
        <Field label="Notas del cliente"><textarea name="notes" maxLength={1000}/></Field>
        <p className="hint">Se creará una persona nueva. No se combinará automáticamente con otros clientes.</p>
      </Form>
    </Modal>}
  </div>;
}
