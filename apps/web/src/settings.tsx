import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { exportData } from './api';
import { Button } from './components/ui/button';

export function Settings() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function download(kind: 'orders' | 'customers') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await exportData(kind);
      setMessage('Descarga iniciada. Revisa las descargas de tu navegador.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <>
    <div className="page-heading"><div><h1>Configuración</h1><p>Administra los datos de tu lavandería.</p></div></div>
    <section className="panel settings-section" aria-labelledby="exports-title">
      <h2 id="exports-title">Datos y exportaciones</h2>
      <p className="muted">Descarga archivos CSV de la empresa activa. Las exportaciones quedan en auditoría.</p>
      <div className="actions">
        <Button variant="outline" disabled={busy} onClick={() => void download('customers')}><Download/>Exportar clientes</Button>
        <Button variant="outline" disabled={busy} onClick={() => void download('orders')}><Download/>Exportar órdenes</Button>
      </div>
      <p className="hint">En el archivo de órdenes los importes están en céntimos: 1500 equivale a S/ 15.00.</p>
      {busy && <p role="status">Preparando descarga…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="success" role="status">{message}</p>}
    </section>
  </>;
}
