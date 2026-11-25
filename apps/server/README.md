# API Go

Backend activo de Lavanda. `pnpm dev` lo inicia en `127.0.0.1:3000`.

## Configuración

`apps/server/.env` es local y está ignorado por Git. Variables:

- `DATABASE_URL`: rol runtime, sin DDL ni permisos destructivos financieros.
- `MIGRATION_DATABASE_URL`: propietario de migraciones, solo CLI.
- `APP_ORIGIN`: origen exacto del navegador.
- `GO_LISTEN_ADDR`: loopback local; `0.0.0.0:3000` dentro del contenedor.
- `MFA_KEY`: 32 bytes aleatorios en hexadecimal, persistentes y respaldados.
- `NODE_ENV`: `development` o `production` (activa cookies Secure).

El servidor no migra al arrancar. `go run ./cmd/api migrate` aplica SQL desde
`../api/migrations` usando exclusivamente la credencial de migración.
`go run ./cmd/api admin correo` habilita plataforma con auditoría; el usuario
deberá configurar y verificar MFA.

`ENV_FILE` permite indicar otro archivo explícitamente. En producción se inyectan
variables de entorno, sin cargar archivos automáticamente.

## Verificación

Desde la raíz: `pnpm test:go`. Requiere Docker `test-db`.
`GO_TEST_DATABASE_URL` puede seleccionar otra base terminada en `_test`.

La suite cubre autenticación compatible, alta directa, revocación, concurrencia,
cuentas existentes, piezas, mínimos históricos, pagos/caja, reintentos, MFA,
calendario, cobertura, reversiones y portabilidad bajo suspensión.

`GO_TEST_RUNTIME_DATABASE_URL` permite repetir los flujos usando el rol limitado
para el servidor y el rol de pruebas para preparar fixtures. Se verifica además
que el runtime no pueda borrar pagos, modificar auditoría, migrar o asignar plataforma.

`test-serve` es exclusivo para E2E: exige `_test`, migra y reinicia los límites
de intentos de esa base. Nunca se usa para desarrollo o producción.
