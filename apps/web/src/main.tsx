import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './query-client';
import { WashingMachine, LayoutDashboard, ClipboardList, Users, Tags, Wallet, ShieldCheck, History, LogOut, UserRoundCog, Menu, Settings as SettingsIcon } from 'lucide-react';
import type { Identity } from '@lav/shared';
import { api, ApiError, companyId, selectCompany } from './api';
import { Auth } from './auth';
import { Customers, Services } from './catalog';
import { Dashboard, CashPage, AuditPage } from './management';
import { Settings } from './settings';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from './workspace-store';
import { Button } from './components/ui/button';
import './styles.css';

const Account = React.lazy(() => import('./accounts').then(module => ({ default: module.Account })));
const Orders = React.lazy(() => import('./orders').then(module => ({ default: module.Orders })));
const TeamAccounts = React.lazy(() => import('./accounts').then(module => ({ default: module.TeamAccounts })));
const SubscriptionPage = React.lazy(() => import('./subscriptions').then(module => ({ default: module.SubscriptionPage })));
const PlatformConsole = React.lazy(() => import('./platform-console').then(module => ({ default: module.PlatformConsole })));

function App() {
  const [identity, setIdentity] = useState<Identity | null>();
  const [error, setError] = useState('');
  const [company, setCompany] = useState(companyId);
  const location = useLocation();
  const route = useNavigate();
  const page = location.pathname.slice(1) || 'dashboard';
  const setPage = (value: string) => route(value === 'dashboard' ? '/' : `/${value}`);
  const [menu, setMenu] = useState(false);

  async function load() {
    setError('');
    try {
      const me = await queryClient.fetchQuery({ queryKey: ['identity'], queryFn: () => api<Identity>('/auth/me'), staleTime: 0 });
      setIdentity(me);
      if (!me.memberships.some(m => m.companyId === companyId)) {
        const id = me.memberships[0]?.companyId ?? '';
        selectCompany(id);
        setCompany(id);
        setPage('dashboard');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setIdentity(null);
      else setError((e as Error).message);
    }
  }
  useEffect(() => {
    const expired = () => { queryClient.clear(); useWorkspaceStore.getState().reset(); setIdentity(null); setPage('dashboard'); setMenu(false); };
    const changed = () => { queryClient.clear(); void load(); };
    window.addEventListener('lavanda:session-expired', expired);
    window.addEventListener('lavanda:access-changed', changed);
    const focused = () => { void load(); };
    window.addEventListener('focus', focused);
    void load();
    return () => { window.removeEventListener('lavanda:session-expired', expired); window.removeEventListener('lavanda:access-changed', changed); window.removeEventListener('focus', focused); };
  }, []);

  if (identity === undefined) return <main className="loading"><WashingMachine size={40}/><h1>Lavanda</h1>{error ? <><p role="alert">{error}</p><Button onClick={load}>Reintentar</Button></> : <p>Preparando tu espacio…</p>}</main>;
  if (!identity) return <Auth ready={load}/>;

  const membership = identity.memberships.find(m => m.companyId === company);
  const manage = Boolean(membership && membership.role !== 'staff');
  const suspended = membership?.status === 'suspended';
  const nav = [
    { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
    { id: 'orders', label: 'Órdenes', icon: ClipboardList },
    { id: 'customers', label: 'Clientes', icon: Users },
    { id: 'services', label: 'Servicios', icon: Tags },
    { id: 'cash', label: 'Caja', icon: Wallet },
    ...(manage ? [
      { id: 'team', label: 'Equipo', icon: UserRoundCog },
      { id: 'audit', label: 'Auditoría', icon: History },
      { id: 'settings', label: 'Configuración', icon: SettingsIcon },
    ] : []),
    ...(identity.platformAdmin ? [{ id: 'platform', label: 'Plataforma', icon: ShieldCheck }] : []),
    ...(membership?.role === 'owner' ? [{ id: 'subscription', label: 'Suscripción', icon: Wallet }] : []),
    { id: 'account', label: 'Mi cuenta', icon: UserRoundCog },
  ];
  function navigate(id: string) { setPage(id); setMenu(false); }

  return <div className="app">
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('dashboard'); }}><WashingMachine/>Lavanda<span>GESTIÓN</span></a>
      <div className="workspace">
        <span>ESPACIO DE TRABAJO</span>
        <select aria-label="Empresa activa" value={company} onChange={e => { selectCompany(e.target.value); setCompany(e.target.value); setPage('dashboard'); }}>
          {identity.memberships.map(m => <option value={m.companyId} key={m.companyId}>{m.companyName}</option>)}
        </select>
        <small>Sede principal · Perú</small>
      </div>
      <nav aria-label="Menú principal">{nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={20}/>{item.label}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="avatar">{identity.name.charAt(0).toUpperCase()}</div>
        <div><strong>{identity.name}</strong><small>{membership?.role === 'owner' ? 'Propietario' : membership?.role === 'manager' ? 'Administrador' : 'Mostrador'}</small></div>
        <Button variant="ghost" aria-label="Cerrar sesión" onClick={async () => {
          try { await api('/auth/logout', 'POST'); setIdentity(null); setPage('dashboard'); setMenu(false); }
          catch (e) { setError((e as Error).message); }
        }}><LogOut/></Button>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <Button variant="ghost" className="mobile-menu" aria-label="Abrir menú" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu/></Button>
        <span>{nav.find(n => n.id === page)?.label}</span>
        <span className="topbar-date">{new Intl.DateTimeFormat('es-PE', { dateStyle: 'full', timeZone: 'America/Lima' }).format(new Date())}</span>
      </header>
      <main className="content" key={`${company}:${page}`}>
        {error && <p className="error" role="alert">{error}</p>}
        <React.Suspense fallback={<p role="status">Cargando pantalla…</p>}>
        {identity.mustChangePassword || page === 'account' ? <Account identity={identity} reload={load}/> :
        page === 'platform' && identity.platformAdmin ? <PlatformConsole identity={identity} reload={load}/> :
        (page === 'subscription' || suspended) && membership?.role === 'owner' ? <SubscriptionPage/> :
        suspended ? <p role="alert" className="hint">La empresa está suspendida. Contacta al propietario para regularizar su suscripción.</p> :
        !membership ? <p>No tienes una empresa asignada.</p> : <>
          {page === 'dashboard' && <Dashboard openOrders={() => navigate('orders')}/>}
          {page === 'orders' && <Orders manage={manage} companyName={membership.companyName}/>}
          {page === 'customers' && <Customers/>}
          {page === 'services' && <Services manage={manage}/>}
          {page === 'cash' && <CashPage manage={manage}/>}
          {page === 'team' && manage && <TeamAccounts/>}
          {page === 'audit' && manage && <AuditPage/>}
          {page === 'settings' && manage && <Settings/>}
          {!nav.some(item => item.id === page) && <p>Página no encontrada. Selecciona una opción del menú.</p>}
        </>}
        </React.Suspense>
      </main>
      <footer className="app-footer">Lavanda · Un día de trabajo más simple.</footer>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></React.StrictMode>);
