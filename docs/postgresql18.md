# PostgreSQL 18: migración local y recuperación

## Resultado de la migración local

El 15/11/2026 se restauró un dump lógico de PostgreSQL 17 en PostgreSQL 18.7
(`postgres:18.7-trixie`). Se compararon las 14 tablas, incluidos usuarios,
contraseñas hash, sesiones, tokens, membresías, catálogo y datos financieros.
Los conteos y hashes del contenido coincidieron.

Para la comparación se ordenaron las filas con `COLLATE "C"`: Alpine y Debian
pueden tener distinta colación predeterminada y ordenar el mismo contenido de
forma diferente. Comparar hashes sin fijar el orden puede producir falsos desacuerdos.

El respaldo local está fuera del repositorio:

`C:\Users\ryan_\AppData\Local\Temp\opencode\laundry-before-pg18-20261115.dump`

Esta ubicación temporal sirve para esta migración; no es un respaldo externo duradero.
No se imprimieron contraseñas ni tokens durante la comparación.

## Volúmenes

- `saas-lavanderia_pgdata`: directorio original de PostgreSQL 17, conservado.
- `saas-lavanderia_pgdata18`: datos restaurados, ahora activos.
- PostgreSQL 18 monta `/var/lib/postgresql`; el PGDATA por defecto es
  `/var/lib/postgresql/18/docker`.
- `test-db` utiliza tmpfs y la base `laundry_test`; no contiene datos de desarrollo.

No ejecutar `docker compose down -v`: eliminaría los volúmenes.

## Procedimiento para otra instalación existente en 17

1. Detener las escrituras de la API y respaldar con `pg_dump -Fc`.
2. Conservar el volumen 17 y guardar el archivo fuera del repositorio.
3. Iniciar una instancia 18 vacía con volumen nuevo. El archivo
   `infra/compose.upgrade.yaml`, combinado con `compose.yaml`, ofrece una instancia
   local en 5434; usarlo solo si `pgdata18` todavía está vacío.
4. Restaurar con `pg_restore --exit-on-error --no-owner`.
5. Comparar todas las tablas con orden determinista, no solo conteos.
6. Detener y quitar exclusivamente el contenedor temporal de actualización.
7. Iniciar `db` y `test-db` con el Compose actualizado y aplicar `pnpm db:migrate`.
8. Ejecutar typecheck, pruebas, build y E2E. Verificar acceso con las cuentas existentes.

No volver a ejecutar la restauración sobre el volumen 18 ya usado.

## Recuperación

El servicio `db-previous` está protegido por el perfil `recovery` y puede iniciarse
explícitamente en 5434 para inspeccionar la copia original con PostgreSQL 17.
El contenedor temporal de actualización y `db-previous` usan ese mismo puerto:
no deben estar activos simultáneamente.

Volver al volumen 17 devuelve los datos al instante previo a la migración; no
incluye escrituras posteriores realizadas en 18. Para un retorno real, detener
escrituras y evaluar esos cambios primero. El código/migraciones deben corresponder
a PostgreSQL 17: `0002_uuidv7_indexes.sql` requiere PostgreSQL 18.

La configuración productiva se alineó a 18 como plantilla. No se ejecutó despliegue.
