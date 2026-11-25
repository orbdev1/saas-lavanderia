import { useState } from 'react';
import type { Identity } from '@lav/shared';
import { api, date } from './api';
import { Field, Form, Modal, useData } from './components/common';
import { DataTable } from './components/data-table';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';

export function Account({ identity, reload }: { identity: Identity; reload: () => Promise<void> }) {
  const sessions = useData(['sessions'], signal => api<{ id: string; userAgent: string; createdAt: string; current: boolean }[]>('/auth/sessions', 'GET', undefined, signal));
  const [remove, setRemove] = useState<string>();
  return <><div className="page-heading"><div><h1>Mi cuenta</h1><p>{identity.name} · {identity.email}</p></div></div>
    {identity.mustChangePassword && <p role="alert" className="hint">Cambia tu contraseña temporal antes de acceder a la lavandería.</p>}
    <section className="panel settings-section"><h2>Cambiar contraseña</h2><Form label="Cambiar contraseña y cerrar sesiones" submit={async data => {
      if (data.get('password') !== data.get('confirm')) throw new Error('Las contraseñas nuevas no coinciden.');
      await api('/auth/password', 'POST', { currentPassword: data.get('currentPassword'), password: data.get('password') }); await reload();
    }}>
      <Field label="Contraseña actual"><Input type="password" name="currentPassword" autoComplete="current-password" required minLength={12} maxLength={128}/></Field>
      <Field label="Nueva contraseña"><Input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field>
      <Field label="Repite la nueva contraseña"><Input type="password" name="confirm" autoComplete="new-password" required minLength={12} maxLength={128}/></Field>
    </Form></section>
    {!identity.mustChangePassword && <MFAPanel done={reload}/>}
    <h2>Sesiones activas</h2>{sessions.error && <p className="error">{sessions.error}</p>}
    <DataTable rows={sessions.data ?? []} label="Sesiones activas" columns={[
      { accessorKey: 'userAgent', header: 'Dispositivo' },
      { accessorKey: 'createdAt', header: 'Inicio', cell: ({ row }) => date(row.original.createdAt) },
      { id: 'action', header: 'Acceso', cell: ({ row }) => <Button variant="outline" onClick={() => setRemove(row.original.id)}>{row.original.current ? 'Cerrar esta sesión' : 'Revocar sesión'}</Button> },
    ]}/>
    {remove && <Modal title="Revocar sesión" close={() => setRemove(undefined)}><Form label="Confirmar revocación" submit={async () => {
      await api(`/auth/sessions/${remove}`, 'DELETE'); setRemove(undefined); await sessions.refresh(); await reload();
    }}><p>Ese dispositivo tendrá que iniciar sesión nuevamente.</p></Form></Modal>}
    <p className="hint">Recuperación asistida: <a href="https://wa.me/51946561987" target="_blank" rel="noreferrer">WhatsApp de soporte</a> · <a href="mailto:ing.ryqm@gmail.com">ing.ryqm@gmail.com</a></p>
  </>;
}

export function MFAPanel({ done }: { done: () => Promise<void> }) {
  const { data, error, refresh } = useData(['mfa'], signal => api<{ enabled: boolean; verified: boolean }>('/auth/mfa', 'GET', undefined, signal));
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [codes, setCodes] = useState<string[]>();
  return <section className="panel settings-section"><h2>Segundo factor de autenticación</h2>
    <p>Obligatorio para administrar la plataforma. Usa una aplicación autenticadora.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p>Cargando seguridad…</p>}
    {data && !data.enabled && !setup && <Form label="Preparar segundo factor" submit={async form => setSetup(await api('/auth/mfa/setup', 'POST', { password: form.get('password') }))}>
      <Field label="Confirma tu contraseña"><Input name="password" type="password" autoComplete="current-password" required/></Field>
    </Form>}
    {setup && !data?.enabled && <><p>Agrega esta clave manualmente en tu autenticador: <code className="secret-key">{setup.secret}</code></p><p className="muted">Cuenta Lavanda · TOTP · 6 dígitos · 30 segundos.</p><Form label="Activar segundo factor" submit={async form => {
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', 'POST', { code: form.get('code') });
      setCodes(result.recoveryCodes); setSetup(undefined); await refresh();
    }}><Field label="Código del autenticador"><Input name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}"/></Field></Form></>}
    {data?.enabled && !data.verified && <Form label="Verificar segundo factor" submit={async form => {
      await api('/auth/mfa/verify', 'POST', { code: form.get('code') }); await refresh(); await done();
    }}><Field label="Código del autenticador o de recuperación"><Input name="code" autoComplete="one-time-code" required minLength={6} maxLength={40}/></Field></Form>}
    {data?.verified && <p role="status">Segundo factor verificado para esta sesión.</p>}
    {codes && <div className="hint"><strong>Guarda estos códigos fuera de este dispositivo. Cada uno funciona una sola vez.</strong><ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><Button variant="outline" onClick={async () => { setCodes(undefined); await done(); }}>Ya guardé mis códigos</Button></div>}
  </section>;
}

interface Member { id: string; name: string; email: string; role: string; active: boolean }
export function TeamAccounts() {
  const { data, error, refresh } = useData(['team'], signal => api<Member[]>('/team', 'GET', undefined, signal));
  const [edit, setEdit] = useState<Member | 'new'>();
  const [message, setMessage] = useState('');
  const selected = edit && edit !== 'new' ? edit : undefined;
  return <><div className="page-heading"><div><h1>Equipo</h1><p>Cuentas personales y acceso inmediato.</p></div><Button onClick={() => setEdit('new')}>Agregar empleado</Button></div>
    {error && <p className="error">{error}</p>}{message && <p role="status" className="hint">{message}</p>}
    <DataTable rows={data ?? []} label="Equipo" columns={[
      { accessorKey: 'name', header: 'Nombre' }, { accessorKey: 'email', header: 'Correo / usuario' },
      { accessorKey: 'role', header: 'Rol', cell: ({ row }) => ({ owner: 'Propietario', manager: 'Administrador', staff: 'Mostrador' }[row.original.role]) },
      { accessorKey: 'active', header: 'Estado', cell: ({ row }) => row.original.active ? 'Activo' : 'Desactivado' },
      { id: 'edit', header: 'Acciones', cell: ({ row }) => row.original.role !== 'owner' && <Button variant="outline" onClick={() => setEdit(row.original)}>Cambiar acceso</Button> },
    ]}/>
    {edit && <Modal title={selected ? `Acceso de ${selected.name}` : 'Agregar empleado'} close={() => setEdit(undefined)}>
      <Form submit={async form => {
        if (selected) await api(`/team/${selected.id}`, 'PATCH', { role: form.get('role'), active: form.get('active') === 'on', reason: form.get('reason') });
        else {
          const result = await api<{ message: string }>('/team', 'POST', Object.fromEntries(form)); setMessage(result.message);
        }
        setEdit(undefined); await refresh();
      }}>
        {!selected && <><Field label="Nombre del empleado"><Input name="name" required minLength={2} maxLength={100}/></Field>
          <Field label="Correo / usuario"><Input name="email" type="email" required/></Field>
          <Field label="Contraseña temporal"><Input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field>
          <p className="hint">Entrégala personalmente. Si el correo ya pertenece a una persona, conservará su contraseña existente.</p></>}
        <Field label="Rol"><select name="role" defaultValue={selected?.role ?? 'staff'}><option value="staff">Mostrador</option><option value="manager">Administrador</option></select></Field>
        {selected && <><label className="check"><input name="active" type="checkbox" defaultChecked={selected.active}/>Acceso activo</label><Field label="Motivo del cambio"><textarea name="reason" required minLength={5} maxLength={500}/></Field></>}
      </Form>
    </Modal>}
    <CancellationRequests/>
  </>;
}
function CancellationRequests() {
  const { data, error, refresh } = useData(['cancellation-requests'], signal => api<{ id: string; orderId: string; reason: string; state: string }[]>('/team/requests', 'GET', undefined, signal));
  const [selected, setSelected] = useState<string>();
  return <><h2>Solicitudes de anulación</h2>{error && <p className="error">{error}</p>}
    <DataTable rows={data ?? []} label="Solicitudes de anulación" columns={[
      { accessorKey: 'reason', header: 'Motivo' }, { accessorKey: 'state', header: 'Estado', cell: ({ row }) => ({ pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' }[row.original.state]) },
      { id: 'action', header: 'Resolver', cell: ({ row }) => row.original.state === 'pending' && <Button variant="outline" onClick={() => setSelected(row.original.id)}>Revisar solicitud</Button> },
    ]}/>
    {selected && <Modal title="Resolver anulación" close={() => setSelected(undefined)}><Form submit={async form => {
      await api(`/team/requests/${selected}/resolve`, 'POST', { approve: form.get('decision') === 'approve', reason: form.get('reason') }); setSelected(undefined); await refresh();
    }}><Field label="Decisión"><select name="decision"><option value="reject">Rechazar</option><option value="approve">Aprobar anulación</option></select></Field><Field label="Motivo de la decisión"><textarea name="reason" required minLength={5}/></Field><p className="hint">Para aprobar, el pedido debe estar abierto y todos los abonos devueltos.</p></Form></Modal>}
  </>;
}
