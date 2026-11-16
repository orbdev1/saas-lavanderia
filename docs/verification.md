# Verificación local

Entorno: Windows, Node 26.13.0, pnpm 12.18.0, PostgreSQL 17 en Docker Desktop.

Comprobado durante la implementación:

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
