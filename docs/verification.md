# Verificación local

Entorno actual: Windows, Node 26.13.0, pnpm 12.18.0, PostgreSQL 18.7 Debian en Docker Desktop.

## Actualización del 15/11/2026

- Typecheck y builds API/web correctos.
- 26 pruebas Vitest: incluye regresiones de cantidades, UUIDv4/v7, exportación
  por empresa/rol, protección CSV, mensajes WhatsApp y límites de consultas.
- E2E ampliado: kilos de dos decimales, rechazo de fracciones de piezas,
  recepción de piezas enteras, avisos de recepción/listo, saldo pagado,
  descarga de clientes desde Configuración y vistas 360/768/1440.
- Diálogo WhatsApp verificado en 360/768px, cierre con Escape y devolución de foco
  sin cerrar el detalle del pedido.
- No se envían mensajes reales: se inspecciona el enlace de WhatsApp.
- Migración 17→18 con comparación determinista de las 14 tablas.
- El volumen anterior permanece disponible. Ver [procedimiento](postgresql18.md).

## Segundo bloque: servicios adicionales y caché

- 35 pruebas Vitest en total, incluyendo añadidos con abonos, mínimos y precios
  históricos, precisión histórica, aislamiento, rollback, reintentos y carreras
  contra pagos y entrega.
- Dos E2E: recorrido de mostrador ampliado con añadidos y regreso de listo a proceso;
  caché de catálogo, separación entre cuentas y redirección ante sesión revocada.
- Formulario adicional probado a 360px; controles ocultos en impresión.
- Migración `0003_order_additions.sql` aplicada a desarrollo después de un nuevo
  `pg_dump -Fc` guardado fuera del repositorio en la carpeta temporal aprobada.

## Tablero y recepción — 16/11/2026

- Typecheck y build aprobados; 36 pruebas Vitest y 2 E2E aprobados.
- Kanban: movimiento de proceso a listo, saldo bloquea entrega, búsqueda, cambio
  entre tablero/lista, navegación con teclado y revisión a 360/768/1440px.
- Historial entregado: no se consulta hasta abrirlo; carga y cierre verificados.
- Recepción: búsqueda por celular/nombre, selección con teclado, alta dentro del
  pedido, conservación de servicios y celular opcional.
- Búsqueda API: aislamiento por empresa y tratamiento literal de `%` y `_`.
- WhatsApp: una sola lectura fresca del pedido por preparación del mensaje.

En desarrollo, `React.StrictMode` monta, limpia y vuelve a montar los efectos.
TanStack Query cancela la primera consulta cuando pierde su observador y el nuevo
montaje puede iniciarla de nuevo: DevTools puede mostrar dos entradas, una cancelada.
Eso es distinto de ejecutar dos mutaciones. También hay lecturas intencionales al
recuperar foco con caché vencida o después de modificar un pedido.

## Backend Go activo y cierre funcional local — 17/11/2026

- Go/chi/pgx sustituye Fastify en `pnpm dev`; TypeScript permanece como referencia.
- `0004` y `0005` aplicadas a desarrollo con respaldo `pg_dump -Fc` previo fuera
  del repositorio. El rol runtime se configuró separado del propietario.
- Pruebas Go con PostgreSQL: credenciales/sesiones legacy, altas y cupos, límites
  concurrentes, idempotencia, caja, devoluciones, carrera entrega/añadido, rollback,
  descuentos autorizados, MFA, recuperación asistida, anulación/cupos solicitados,
  calendario, gracia, prórrogas, reversiones y exportación durante suspensión.
- La misma suite financiera/MFA/comercial pasa usando `laundry_app` limitado.
  Se verificó por SQL y pruebas que no puede borrar pagos, modificar auditoría,
  consultar migraciones ni asignar `platform_admin`.
- 36 pruebas Vitest históricas y cuatro E2E Chromium contra Go:
  mostrador completo, separación de cuentas, empleado temporal/desactivado y
  plataforma con MFA, plan, cuota, pago y solicitud estando suspendida.
- Recepción E2E incluye notas por servicio, descuento, express y prendas.
- Cuenta y formularios comerciales comprobados a 360px/768px, y escritorio.
- `go vet`, typecheck y compilaciones ejecutados. En Windows se usaron pruebas
  concurrentes contra PostgreSQL; el detector `-race` requiere CGO y no se ejecutó.
- El servidor local responde por el proxy Vite en `http://localhost:5173/api/health`.
  Infraestructura remota y plantillas Docker productivas no se consideran desplegadas.

## Verificación histórica del MVP

Comprobado antes de esta actualización:

- Instalación completa, incluido módulo nativo Argon2.
- TypeScript estricto y compilación independiente de API y web.
- 16 pruebas Vitest: precios, validación, aislamiento entre empresas, claves foráneas, reintentos concurrentes, sobrepago, bloqueo de entrega con saldo, caja/devoluciones/anulación, permisos, superadmin, invitaciones de un uso, recuperación y revocación de sesiones.
- E2E Chromium: registro, cliente, orden con mínimo, pago Yape manual, procesamiento, entrega, contenido imprimible y navegación responsive 360/768/1440px.
- Inspección de capturas de dashboard en escritorio y móvil.
- Construcción de `infra/api.Dockerfile` y `infra/web.Dockerfile`.
- Validación del Caddyfile y healthcheck de API compilada dentro del contenedor, conectada a PostgreSQL.
- Backup de base de pruebas, restauración en otra base y comparación coincidente de conteos y sumas; eliminación exclusiva de la base temporal creada para comprobar restauración.

Los servicios de desarrollo pueden iniciarse con `pnpm dev`. La base de desarrollo se migró; crea tu cuenta desde la pantalla inicial. Los datos de los tests están solo en `laundry_test`.

No se ejecutó un despliegue público con dominio real ni envío de correo mediante credenciales reales. Tickets verificados con CSS de impresión en Chromium; el formato físico debe ajustarse a la impresora de la lavandería durante el piloto.
