# Estado de implementación — 17/11/2026

## Activo y verificado localmente

- `pnpm dev` ejecuta Go (`chi`/`pgx`) y React/Vite. PostgreSQL 18.7 Debian,
  UUIDv7 nuevo y compatibilidad con UUIDv4, hashes Argon2id y sesiones anteriores.
- Pedidos, añadidos, estados, abonos/devoluciones, caja, reportes y CSV portados.
  Bloqueo empresa → orden → caja; dinero entero; auditoría e idempotencia atómicas.
  La serialización legacy de fingerprints se conserva para reintentos antiguos.
- Sesiones opacas revocables, inventario de sesiones, límites persistentes de
  intentos, cambio obligatorio de contraseña temporal y recuperación manual.
- Altas directas de empleados, identidades existentes preservadas, desactivación,
  protección del propietario y cupos configurables.
- MFA de plataforma: TOTP cifrado con AES-GCM, protección contra reutilización,
  códigos de recuperación de un uso y exigencia por sesión.
- Planes configurables; cuotas mensuales/anuales con día ancla, últimos días de
  mes y recuperación del día original. Pagos manuales con referencia y período,
  reversiones sin borrar pagos, gastos y métricas únicamente de plataforma.
- Tres días de gracia, prórrogas auditadas y suspensión efectiva comprobada en
  cada acceso. La suspensión manual sigue teniendo prioridad.
- Solicitudes de cupos, exportación asistida y anulaciones; aprobación auditada.
  El propietario suspendido puede pedir y descargar sus datos aprobados.
- Kanban Por hacer / En proceso / Listo; entregados y anulados desplegables,
  paginación por estado, vista de lista y búsqueda con debounce.
- Recepción: búsqueda de clientes en servidor, creación dentro del pedido,
  servicios por unidad, cantidades rápidas, notas por servicio, entrega rápida,
  descuento autorizado en soles, express sin recargo y número de prendas.
- WhatsApp manual de recepción/listo, texto editable y saldo actualizado.
- React Router, TanStack Query/Table, Zustand para preferencias de vista en
  memoria, React Hook Form/Zod en añadidos y validación Zod de recepción.
  No se persisten datos de clientes ni contraseñas en el estado del navegador.
- Credencial de ejecución separada de migraciones. Sin DDL, borrado financiero,
  modificación de auditoría ni asignación de rol plataforma desde el rol runtime.

## Datos y verificaciones

`0004_accounts_billing_counter.sql` y `0005_mfa_billing_integrity.sql` aplicadas
localmente después de `pg_dump -Fc` guardado fuera del repositorio. No se editaron
migraciones aplicadas ni se descartaron los datos originales.

Verificaciones: TypeScript, `go vet`, compilaciones, 36 pruebas Vitest, pruebas Go
con PostgreSQL y cuatro recorridos E2E Chromium contra Go. La suite Go también se
ejecutó con el rol runtime limitado; se comprobó la denegación de permisos
destructivos. Detalles en `docs/verification.md`.

## Decisiones expresamente aplazadas

- Precios y cupos definitivos: se ingresan desde Plataforma.
- Redondeo comercial: desactivado hasta acordar su regla.
- Multisucursal operativa y landing: etapas posteriores.
- VPS, dominio, Fail2ban, monitoreo y backups externos: etapa de infraestructura.
  Hay plantillas Docker con límites, pero no despliegue remoto verificado.
- `sqlc` y OpenAPI se evaluaron como opciones; la implementación usa consultas
  parametrizadas con pgx y contratos documentados/pruebas HTTP.

El backend Fastify y sus pruebas se conservan como referencia de regresión; ya no
se ejecutan con `pnpm dev`.
