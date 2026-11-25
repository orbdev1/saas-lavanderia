import { useState } from 'react';
import { api } from './api';
import { Field, Form, Modal } from './components/common';
import { Input } from './components/ui/input';

export const requestLabel: Record<string, string> = { seats: 'Ampliación de usuarios', export: 'Exportación de datos', cancel: 'Anulación' };
export function RequestForm({ kind, orderId, close, done }: { kind: string; orderId?: string; close: () => void; done: () => void | Promise<void> }) {
  const [requestId] = useState(() => crypto.randomUUID());
  return <Modal title={requestLabel[kind]} close={close}><Form label="Enviar solicitud" submit={async form => {
    await api('/requests', 'POST', { kind, orderId, reason: form.get('reason'), ...(kind === 'seats' ? { seats: Number(form.get('seats')) } : {}), requestId }); await done();
  }}>{kind === 'seats' && <Field label="Usuarios adicionales"><Input name="seats" type="number" min={1} max={1000} required/></Field>}<Field label="Motivo"><textarea name="reason" required minLength={5} maxLength={500}/></Field><p className="hint">La solicitud quedará registrada para revisión manual.</p></Form></Modal>;
}
