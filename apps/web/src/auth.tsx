import { useState } from 'react';
import { WashingMachine } from 'lucide-react';
import { api } from './api';
import { Form, Field } from './components/common';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';

export function Auth({ ready }: { ready: () => void }) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState(params.has('reset') ? 'reset' : params.has('invite') ? 'accept' : 'login');
  const [message, setMessage] = useState('');
  const titles: Record<string, string> = { login: 'Tu lavandería, en orden.', register: 'Empieza con tu lavandería', forgot: 'Recupera tu cuenta', reset: 'Elige una contraseña nueva', accept: 'Únete a tu equipo' };
  return <main className="auth"><section className="auth-brand"><div className="brand"><WashingMachine/> Lavanda</div><h1>Menos pendientes.<br/>Más tranquilidad.</h1><p>Pedidos, cobros y clientes.<br/>Todo en un solo lugar.</p><div className="brand-note">Hecho para el día a día de tu lavandería.</div></section><section className="auth-form"><div className="auth-inner"><div className="eyebrow">GESTIÓN DE LAVANDERÍAS</div><h2>{titles[mode]}</h2><p className="muted">{mode === 'login' ? 'Ingresa para continuar con tu jornada.' : 'Completa tus datos para continuar.'}</p>
    {message ? <><p role="status" className="success">{message}</p><Button onClick={() => { setMode('login'); setMessage(''); history.replaceState(null, '', '/'); }}>Volver al inicio</Button></> : <Form key={mode} label={{ login: 'Ingresar', register: 'Crear mi cuenta', forgot: 'Enviar enlace', reset: 'Cambiar contraseña', accept: 'Aceptar invitación' }[mode]} submit={async data => {
      const body = Object.fromEntries(data); if (mode === 'accept') body.token = params.get('invite')!; if (mode === 'reset') body.token = params.get('reset')!;
      await api(`/auth/${mode}`, 'POST', body);
      if (mode === 'forgot') setMessage('Si el correo está registrado, recibirás un enlace para recuperar tu cuenta.');
      else if (mode === 'reset') setMessage('Contraseña actualizada. Ya puedes ingresar.');
      else { history.replaceState(null, '', '/'); ready(); }
    }}>
      {['register', 'accept'].includes(mode) && <Field label="Tu nombre"><Input name="name" required autoComplete="name" minLength={2}/></Field>}
      {mode === 'register' && <Field label="Nombre de la lavandería"><Input name="company" required minLength={2}/></Field>}
      {mode !== 'reset' && <Field label="Correo electrónico"><Input name="email" type="email" required autoComplete="email"/></Field>}
      {mode !== 'forgot' && <Field label={mode === 'accept' ? 'Contraseña (la actual si ya tienes cuenta)' : 'Contraseña'}><Input name="password" type="password" required minLength={12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/><small>Mínimo 12 caracteres.</small></Field>}
    </Form>}
    {!message && <div className="auth-links">{mode === 'login' ? <><Button variant="ghost" onClick={() => setMode('forgot')}>Olvidé mi contraseña</Button><p>¿Es tu primera vez? <button onClick={() => setMode('register')}>Crear lavandería</button></p></> : <Button variant="ghost" onClick={() => setMode('login')}>Ya tengo una cuenta</Button>}</div>}
  </div></section></main>;
}
