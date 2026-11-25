import { useState } from 'react';
import { WashingMachine } from 'lucide-react';
import { api } from './api';
import { Form, Field } from './components/common';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { useNavigate } from 'react-router-dom';

export function Auth({ ready }: { ready: () => void }) {
  const params = new URLSearchParams(location.search);
  const navigate = useNavigate();
  const [mode, setMode] = useState(params.has('reset') ? 'reset' : 'login');
  const [message, setMessage] = useState(params.has('invite') ? 'El alta del equipo ahora es directa. Solicita tus datos de acceso al propietario o administrador.' : '');
  const titles: Record<string, string> = { login: 'Tu lavandería, en orden.', register: 'Empieza con tu lavandería', forgot: 'Recupera tu cuenta', reset: 'Elige una contraseña nueva' };
  return <main className="auth"><section className="auth-brand"><div className="brand"><WashingMachine/> Lavanda</div><h1>Menos pendientes.<br/>Más tranquilidad.</h1><p>Pedidos, cobros y clientes.<br/>Todo en un solo lugar.</p><div className="brand-note">Hecho para el día a día de tu lavandería.</div></section><section className="auth-form"><div className="auth-inner"><div className="eyebrow">GESTIÓN DE LAVANDERÍAS</div><h2>{titles[mode]}</h2><p className="muted">{mode === 'login' ? 'Ingresa para continuar con tu jornada.' : 'Completa tus datos para continuar.'}</p>
    {message ? <><p role="status" className="success">{message}</p><Button onClick={() => { setMode('login'); setMessage(''); navigate('/', { replace: true }); }}>Volver al inicio</Button></> : mode === 'forgot' ? <section className="hint"><p>La recuperación es asistida. Contacta a soporte para verificar tu identidad y recibir un enlace privado.</p><div className="actions"><Button asChild><a href="https://wa.me/51946561987" target="_blank" rel="noreferrer">Contactar por WhatsApp</a></Button><a href="mailto:ing.ryqm@gmail.com">ing.ryqm@gmail.com</a></div><p>No se envían correos ni mensajes automáticos.</p></section> : <Form key={mode} label={{ login: 'Ingresar', register: 'Crear mi cuenta', reset: 'Cambiar contraseña' }[mode]} submit={async data => {
      const body = Object.fromEntries(data); if (mode === 'reset') body.token = params.get('reset')!;
      await api(`/auth/${mode}`, 'POST', body);
      if (mode === 'reset') setMessage('Contraseña actualizada. Ya puedes ingresar.');
      else { navigate('/', { replace: true }); ready(); }
    }}>
      {mode === 'register' && <Field label="Tu nombre"><Input name="name" required autoComplete="name" minLength={2}/></Field>}
      {mode === 'register' && <Field label="Nombre de la lavandería"><Input name="company" required minLength={2}/></Field>}
      {mode !== 'reset' && <Field label="Correo electrónico"><Input name="email" type="email" required autoComplete="email"/></Field>}
      <Field label="Contraseña"><Input name="password" type="password" required minLength={12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/><small>Mínimo 12 caracteres.</small></Field>
    </Form>}
    {!message && <div className="auth-links">{mode === 'login' ? <><Button variant="ghost" onClick={() => setMode('forgot')}>Olvidé mi contraseña</Button><p>¿Es tu primera vez? <button onClick={() => setMode('register')}>Crear lavandería</button></p></> : <Button variant="ghost" onClick={() => setMode('login')}>Ya tengo una cuenta</Button>}</div>}
  </div></section></main>;
}
