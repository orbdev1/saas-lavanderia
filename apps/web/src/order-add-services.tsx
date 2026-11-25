import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { orderAdditionInput, priceLine, type OrderAdditionInput, type OrderDetail, type Service } from '@lav/shared';
import { api, currency } from './api';
import { Field, Modal, useData } from './components/common';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';

export function AddOrderServices({ order: currentOrder, close, done }: { order: OrderDetail; close: () => void; done: () => void }) {
  // Freeze the form's optimistic-concurrency baseline while background queries refresh.
  const [order] = useState(currentOrder);
  const { data: services, error } = useData(['services'], signal => api<Service[]>('/services', 'GET', undefined, signal));
  const [requestId] = useState(() => crypto.randomUUID());
  const [failure, setFailure] = useState('');
  const lock = useRef(false);
  const { register, watch, handleSubmit, formState: { errors, isSubmitting } } = useForm<OrderAdditionInput>({
    resolver: zodResolver(orderAdditionInput),
    defaultValues: {
      items: [{ serviceId: '', quantity: 1 }], reason: '', requestId,
      expectedTotal: order.total, expectedStatus: order.status,
    },
  });
  const item = watch('items.0');
  const service = services?.find(s => s.id === item.serviceId);
  const original = order.items.find(i => i.serviceId === item.serviceId);
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
  const estimate = service && quantity > 0
    ? priceLine(Number(original?.actual ?? 0) + quantity, original ? Number(original.charged) : service.minimum, original?.price ?? service.price).total - (original?.total ?? 0)
    : 0;
  const piece = service?.unit === 'piece';
  const itemErrors = errors.items?.[0];

  return <Modal title={`Agregar servicio · Orden #${String(order.number).padStart(4, '0')}`} close={close}>
    <form className="form" onSubmit={handleSubmit(async input => {
      if (lock.current) return;
      lock.current = true;
      setFailure('');
      try {
        await api(`/orders/${order.id}/services`, 'POST', input);
        done();
      } catch (e) {
        setFailure(e instanceof Error ? e.message : 'No se pudo agregar el servicio');
      } finally {
        lock.current = false;
      }
    })}>
      <fieldset disabled={isSubmitting}>
        {order.status === 'ready' && <p className="hint">Este pedido está listo. Al agregar trabajo volverá a «En proceso» y deberá marcarse listo nuevamente antes de entregarlo.</p>}
        <Field label="Servicio adicional">
          <select {...register('items.0.serviceId')} required aria-invalid={Boolean(itemErrors?.serviceId)}>
            <option value="">Seleccionar servicio</option>
            {services?.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} · {s.unit === 'kg' ? 'kg' : 'pieza'}</option>)}
          </select>
          {itemErrors?.serviceId && <small className="error">Selecciona un servicio.</small>}
        </Field>
        <Field label="Cantidad que se agrega">
          <Input {...register('items.0.quantity', { valueAsNumber: true })} type="number" inputMode={piece ? 'numeric' : 'decimal'}
            required min={piece ? 1 : 0.01} step={piece ? 1 : 0.01} max={10000} aria-invalid={Boolean(itemErrors?.quantity)}/>
          {itemErrors?.quantity && <small className="error">{itemErrors.quantity.message}</small>}
        </Field>
        <p className="hint">{original
          ? 'Este servicio ya está en el pedido: se sumará la cantidad conservando el precio y el mínimo originales.'
          : 'El servicio nuevo se cobrará con el precio y mínimo vigentes del catálogo.'}</p>
        <Field label="Motivo del añadido">
          <textarea {...register('reason')} required minLength={5} maxLength={500} placeholder="El cliente solicita un servicio adicional" aria-invalid={Boolean(errors.reason)}/>
          {errors.reason && <small className="error">{errors.reason.message}</small>}
        </Field>
        <div className="totals" aria-live="polite">
          <p>Adicional estimado <strong>{currency(estimate)}</strong></p>
          <p>Nuevo total estimado <strong>{currency(order.total + estimate)}</strong></p>
          <p>Ya cobrado <strong>{currency(order.paid)}</strong></p>
          <p>Saldo estimado <strong>{currency(order.total + estimate - order.paid)}</strong></p>
        </div>
        <p className="muted">El servidor confirma los importes. Los pagos y el número de pedido se conservan. Si necesitas cambiar la entrega, usa «Corregir fecha / notas».</p>
      </fieldset>
      {(failure || error) && <p className="error" role="alert">{failure || error}</p>}
      <Button type="submit" disabled={isSubmitting || !service}>{isSubmitting ? 'Agregando…' : 'Confirmar servicio adicional'}</Button>
    </form>
  </Modal>;
}
