import { test, expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import pg from 'pg';

async function register(page: Page, company: string) {
  const email = `${crypto.randomUUID()}@example.test`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear lavandería' }).click();
  await page.getByLabel('Tu nombre').fill('Propietario de prueba');
  await page.getByLabel('Nombre de la lavandería').fill(company);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('Prueba-segura-123!');
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Buen día. Todo bajo control.' })).toBeVisible();
  return email;
}
async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
}
function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map(part => parseInt(part, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

test('alta directa, contraseña temporal, desactivación y propietario protegido', async ({ page, browser }) => {
  await register(page, 'Equipo E2E');
  const me = await (await page.request.get('/api/auth/me')).json();
  const company = me.memberships[0].companyId;
  await page.getByRole('button', { name: 'Equipo', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar empleado', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Agregar empleado' });
  const email = `${crypto.randomUUID()}@example.test`;
  await add.getByLabel('Nombre del empleado').fill('Empleado mostrador E2E');
  await add.getByLabel('Correo / usuario').fill(email);
  await add.getByLabel('Contraseña temporal').fill('Temporal-segura-123!');
  await add.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(add).not.toBeVisible();
  await expect(page.getByRole('table', { name: 'Equipo' })).toContainText(email);
  const employeeContext = await browser.newContext({ baseURL: 'http://localhost:5174' });
  const employee = await employeeContext.newPage();
  try {
    await login(employee, email, 'Temporal-segura-123!');
    await expect(employee.getByRole('heading', { name: 'Mi cuenta', exact: true })).toBeVisible();
    await expect(employee.getByText('Cambia tu contraseña temporal antes de acceder a la lavandería.')).toBeVisible();
    for (const width of [360, 768]) {
      await employee.setViewportSize({ width, height: 1000 });
      expect(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await employee.screenshot({ path: `test-results/cuenta-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    await employee.setViewportSize({ width: 1440, height: 1000 });
    await employee.getByLabel('Contraseña actual', { exact: true }).fill('Temporal-segura-123!');
    await employee.getByLabel('Nueva contraseña', { exact: true }).fill('Definitiva-segura-456!');
    await employee.getByLabel('Repite la nueva contraseña').fill('Definitiva-segura-456!');
    await employee.getByRole('button', { name: 'Cambiar contraseña y cerrar sesiones' }).click();
    await expect(employee.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
    await login(employee, email, 'Definitiva-segura-456!');
    await expect(employee.getByRole('heading', { name: 'Buen día. Todo bajo control.' })).toBeVisible();
    await expect(employee.getByRole('button', { name: 'Equipo', exact: true })).toHaveCount(0);
    await employee.getByRole('button', { name: 'Órdenes', exact: true }).click();
    await expect(employee.getByRole('region', { name: 'Por hacer', exact: true })).toBeVisible();
    const ownerChange = await page.request.patch(`/api/team/${me.id}`, { headers: { Origin: 'http://localhost:5174', 'X-Company-Id': company }, data: { role: 'staff', active: false, reason: 'Intento de desactivar propietario' } });
    expect(ownerChange.status()).toBe(403);
    const row = page.getByRole('table', { name: 'Equipo' }).getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: 'Cambiar acceso' }).click();
    const edit = page.getByRole('dialog', { name: 'Acceso de Empleado mostrador E2E' });
    await edit.getByLabel('Acceso activo').uncheck();
    await edit.getByLabel('Motivo del cambio').fill('Finalizó su relación laboral');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(edit).not.toBeVisible();
    await employee.getByRole('button', { name: 'Clientes', exact: true }).click();
    await expect(employee.getByText('No tienes una empresa asignada.')).toBeVisible();
  } finally { await employeeContext.close(); }
});

test('plataforma con MFA, planes configurables, cuota y pago manual', async ({ page }) => {
  test.setTimeout(120000);
  const companyName = `Plataforma E2E ${crypto.randomUUID().slice(0, 6)}`;
  const email = await register(page, companyName);
  const database = process.env.TEST_DATABASE_URL || 'postgres://laundry:laundry_test@localhost:5433/laundry_test';
  if (!new URL(database).pathname.endsWith('_test')) throw new Error('Solo base _test');
  const pool = new pg.Pool({ connectionString: database, max: 1 });
  try { await pool.query('UPDATE users SET platform_admin=true WHERE email=$1', [email]); } finally { await pool.end(); }
  await page.reload();
  await page.getByRole('button', { name: 'Plataforma', exact: true }).click();
  await page.getByLabel('Confirma tu contraseña').fill('Prueba-segura-123!');
  await page.getByRole('button', { name: 'Preparar segundo factor' }).click();
  const secret = (await page.locator('.secret-key').textContent())!.trim();
  await page.getByLabel('Código del autenticador', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Activar segundo factor' }).click();
  await expect(page.getByText('Guarda estos códigos fuera de este dispositivo. Cada uno funciona una sola vez.')).toBeVisible();
  await page.getByRole('button', { name: 'Ya guardé mis códigos' }).click();
  await expect(page.getByRole('heading', { name: 'Planes configurables' })).toBeVisible();
  await page.getByRole('button', { name: 'Crear plan', exact: true }).click();
  const plan = page.getByRole('dialog', { name: 'Crear plan' });
  const planName = `Plan E2E ${crypto.randomUUID().slice(0, 6)}`;
  await plan.getByLabel('Nombre del plan').fill(planName);
  await plan.getByLabel('Mensualidad (S/)').fill('39');
  await plan.getByLabel('Anualidad (S/)').fill('399');
  await plan.getByLabel('Cupo de usuarios (opcional)').fill('3');
  await plan.getByLabel('Motivo / sustento').fill('Plan de prueba configurable');
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await plan.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/plan-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await plan.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(plan).not.toBeVisible();
  await page.getByRole('table', { name: 'Empresas', exact: true }).getByRole('row').filter({ hasText: companyName }).getByRole('button', { name: 'Ver empresa' }).click();
  const company = page.getByRole('dialog', { name: companyName });
  await company.getByRole('button', { name: 'Configurar suscripción' }).click();
  const config = page.getByRole('dialog', { name: 'Configurar suscripción' });
  await config.getByLabel('Plan', { exact: true }).selectOption({ label: planName });
  await config.getByLabel('Fecha ancla original').fill('2026-01-31');
  await config.getByLabel('Motivo / sustento').fill('Contrato mensual acordado');
  await config.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(config).not.toBeVisible();
  await company.getByRole('button', { name: 'Generar cuota', exact: true }).click();
  const charge = page.getByRole('dialog', { name: 'Generar siguiente cuota' });
  await charge.getByLabel('Motivo / sustento').fill('Cuota inicial del período');
  await charge.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(charge).not.toBeVisible();
  await expect(company.getByRole('table', { name: 'Cuotas de la empresa' })).toContainText('2026-02-28');
  await company.getByRole('button', { name: 'Registrar pago SaaS' }).click();
  const payment = page.getByRole('dialog', { name: 'Registrar pago SaaS' });
  await payment.getByLabel('Referencia / constancia').fill('TRANSFERENCIA-E2E');
  await payment.getByLabel('Fecha de pago').fill('2026-02-01');
  await payment.getByLabel('Motivo / sustento').fill('Transferencia revisada manualmente');
  await payment.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(payment).not.toBeVisible();
  await expect(company.getByRole('table', { name: 'Pagos de la empresa' })).toContainText('TRANSFERENCIA-E2E');
  await company.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Suscripción', exact: true }).click();
  await expect(page.getByText('Acceso: Suspendido')).toBeVisible();
  await page.getByRole('button', { name: 'Solicitar mis datos' }).click();
  const request = page.getByRole('dialog', { name: 'Exportación de datos' });
  await request.getByLabel('Motivo', { exact: true }).fill('Necesito una copia de mis datos');
  await request.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(request).not.toBeVisible();
  await expect(page.getByRole('table', { name: 'Mis solicitudes' })).toContainText('Pendiente');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Suscripción y solicitudes' })).toBeVisible();
});
