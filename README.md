# Lavanda · SaaS para lavanderías

Monorepo TypeScript: Fastify + PostgreSQL/Drizzle, React/Vite + Tailwind y componentes editables shadcn/ui. Node **26.13.0**, pnpm **12.18.0**.

## Iniciar en desarrollo (PowerShell)

Abre Docker Desktop y ejecuta desde la raíz:

```powershell
pnpm install --frozen-lockfile
Copy-Item apps/api/.env.example apps/api/.env
pnpm db:up
pnpm db:migrate
pnpm dev
```

Abre **http://localhost:5173** y pulsa **Crear lavandería**. La API escucha en `http://localhost:3000/api`; Vite actúa como proxy, por lo que las cookies son del mismo origen. Usa `localhost`, no `127.0.0.1`, en el navegador.

`Copy-Item` solo se necesita la primera vez; conserva tu `.env` existente. Hay dos bases: desarrollo en 5432 (persistente) y pruebas en 5433 (temporal).

### Primer recorrido

1. Registra una cuenta y una lavandería. Los precios iniciales son ejemplos editables.
2. Revisa **Servicios**: por defecto ropa a S/6 por kg, mínimo 3 kg; edredón por pieza; seco por pieza.
3. Crea un cliente en **Clientes**.
4. Abre **Caja** si vas a cobrar efectivo.
5. En **Órdenes**, recibe 2 kg: el total del servicio por defecto es S/18.
6. Abre la orden y registra un anticipo. Revisa ticket, etiqueta y enlace manual de WhatsApp.
7. Inicia lavado → marca listo → cobra saldo → entrega.
8. Revisa **Resumen**, exportación CSV, cierre de caja y auditoría.

### Administrador de plataforma

Registra primero tu cuenta y después ejecuta:

```powershell
pnpm admin tu-correo@ejemplo.com
```

Actualiza la página. **Plataforma** muestra métricas globales y permite gestionar estado y deuda de suscripciones. Este privilegio solo se concede mediante la herramienta de administración del servidor; no existe un campo de registro público para activarlo.

### Invitaciones y recuperación

En desarrollo, sin proveedor de correo, los enlaces aparecen en la consola de la API. En producción configura `MAIL_API_KEY` (Resend) y `MAIL_FROM` con dominio verificado. Las invitaciones permiten crear una cuenta o usar la contraseña de una cuenta existente.

## Verificación

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Las pruebas de API usan PostgreSQL real y rechazan bases cuyo nombre no termine en `_test`. No eliminan datos existentes; crean empresas únicas. Para otra base de pruebas, define `TEST_DATABASE_URL`.
El E2E levanta sus propios servidores en 3001/5174 y usa la base de pruebas migrada por `pnpm test`. Recorre registro → cliente → orden → pago → entrega, impresión y navegación móvil en Chromium.

Compilaciones independientes:

```powershell
pnpm --filter @lav/api build
pnpm --filter @lav/web build
```

## Estructura

```text
apps/api/src/        Autenticación, autorización, operaciones, reportes
apps/api/migrations/ Migraciones SQL versionadas
apps/api/test/       Reglas financieras e integración multiempresa
apps/web/src/        Aplicación React y componentes UI editables
packages/shared/    Contratos Zod, tipos y cálculo de importes
docs/               Reglas, arquitectura y operaciones
infra/              Docker y proxy HTTPS para despliegue
```

La landing queda fuera del workspace ejecutable. Consulta [reglas y alcance](docs/architecture.md), [contratos](docs/api.md) y [despliegue y backups](docs/operations.md).
