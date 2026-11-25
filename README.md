# Lavanda · SaaS para lavanderías

Monolito modular con **Go 1.27 / chi / pgx**, PostgreSQL, React/Vite, Tailwind y componentes editables shadcn/ui. Node **26.13.0**, pnpm **12.18.0** para el frontend.

Base local: **PostgreSQL 18.7 sobre Debian**, UUIDv7 para nuevas entidades.
El backend activo es Go. Fastify se conserva como referencia y para ejecutar las pruebas históricas de paridad.
Estado del alcance: [implementación por etapas](docs/implementation.md).

## Iniciar en desarrollo (PowerShell)

Abre Docker Desktop y ejecuta desde la raíz:

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm dev
```

Abre **http://localhost:5173** y pulsa **Crear lavandería**. La API escucha en `http://localhost:3000/api`; Vite actúa como proxy, por lo que las cookies son del mismo origen. Usa `localhost`, no `127.0.0.1`, en el navegador.

En esta máquina `apps/server/.env` y los roles ya están configurados. Conserva ese
archivo: contiene la clave persistente de cifrado MFA. Para una instalación nueva,
usa `apps/server/.env.example`, genera una clave aleatoria de 32 bytes en hexadecimal,
crea el rol `laundry_app` con contraseña propia y aplica `infra/runtime-grants.sql`
como propietario de las migraciones. Nunca uses credenciales reales en `_test`.
Hay dos bases: desarrollo en 5432 (persistente) y pruebas en 5433 (temporal).
Después de migraciones nuevas, vuelve a aplicar los permisos de ejecución.
Go se compila al iniciar; tras editar el backend, reinicia `pnpm dev`.

### Primer recorrido

1. Registra una cuenta y una lavandería. Los precios iniciales son ejemplos editables.
2. Revisa **Servicios**: por defecto ropa a S/6 por kg, mínimo 3 kg; edredón por pieza; seco por pieza.
3. Crea un cliente en **Clientes** o directamente al recibir un pedido.
4. Abre **Caja** si vas a cobrar efectivo.
5. En **Órdenes**, recibe 2 kg: el total del servicio por defecto es S/18.
6. Abre la orden y registra un anticipo. Revisa ticket, etiqueta y enlace manual de WhatsApp.
7. Inicia lavado → marca listo → cobra saldo → entrega.
8. Revisa **Resumen**, exportación CSV, cierre de caja y auditoría.

Las exportaciones de clientes y órdenes están en **Configuración → Datos y exportaciones**
(propietario/administrador). Los avisos de recepción y pedido listo abren una vista previa
editable y luego WhatsApp; la persona debe pulsar Enviar en WhatsApp.

Cantidades nuevas: piezas enteras desde 1, kilos desde 0.01 y máximo dos decimales.
La precisión de órdenes históricas se conserva.

En el detalle de un pedido abierto puedes **Agregar servicio al pedido**: se
conservan número y abonos. Si ya estaba listo, vuelve a «En proceso». Los servicios
repetidos mantienen su precio y mínimo históricos. Los entregados/anulados no admiten añadidos.

Las consultas usan TanStack Query con caché por empresa y actualización al recuperar
foco/conexión cuando los datos están vencidos. StrictMode sigue activo: pueden aparecer
peticiones canceladas durante el montaje de desarrollo.

Si vienes de PostgreSQL 17, consulta [la migración local](docs/postgresql18.md)
antes de iniciar los servicios. Se usa un volumen nuevo; no se reutiliza el directorio de datos de 17.

### Administrador de plataforma

Registra primero tu cuenta y después ejecuta:

```powershell
pnpm admin tu-correo@ejemplo.com
```

Actualiza la página y configura **MFA**: aplicación autenticadora y códigos de
recuperación de un solo uso. **Plataforma** permite configurar planes, asignar
suscripciones, emitir cuotas por calendario, registrar pagos/reversiones y gastos,
otorgar prórrogas y resolver solicitudes. El rol solo se concede mediante esta
herramienta auditada; el registro público no lo admite.

### Equipo y recuperación

El dueño o administrador agrega empleados con nombre, correo y contraseña temporal.
Las personas existentes conservan sus credenciales. Desactivar un empleado conserva
su historial e impide nuevas operaciones en esa empresa.

La recuperación se coordina manualmente por WhatsApp **+51946561987** o
**ing.ryqm@gmail.com**. Plataforma genera un enlace privado de 30 minutos después
de verificar la identidad. No hay correos ni mensajes automáticos.

**Mi cuenta** permite cambiar contraseña, revisar/revocar sesiones y configurar MFA.
**Suscripción** conserva el acceso del propietario a solicitudes de datos incluso
si la empresa está suspendida. Los precios y cupos se configuran, no vienen fijados.

## Verificación

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Las pruebas de API usan PostgreSQL real y rechazan bases cuyo nombre no termine en `_test`. No eliminan datos existentes; crean empresas únicas. Para otra base de pruebas, define `TEST_DATABASE_URL`.
El E2E levanta Go/Vite en 3001/5174, migra únicamente `_test` y reinicia allí los
contadores de intentos para aislar ejecuciones. Cubre mostrador, Kanban, impresión,
cuentas, contraseña temporal, revocación empresarial, MFA, planes y pagos SaaS.
`pnpm test` ejecuta 36 pruebas históricas más las pruebas Go con PostgreSQL.

Compilaciones independientes:

```powershell
pnpm --filter @lav/server build
pnpm --filter @lav/web build
```

## Estructura

```text
apps/server/         Backend Go activo, seguridad, operaciones y administración SaaS
apps/api/src/        Backend anterior, referencia de paridad
apps/api/migrations/ Migraciones SQL versionadas
apps/api/test/       Reglas financieras e integración multiempresa
apps/web/src/        Aplicación React y componentes UI editables
packages/shared/    Contratos Zod, tipos y cálculo de importes
docs/               Reglas, arquitectura y operaciones
infra/              Docker y proxy HTTPS para despliegue
```

La landing queda fuera del workspace ejecutable. Consulta [reglas y alcance](docs/architecture.md), [contratos](docs/api.md) y [despliegue y backups](docs/operations.md).
