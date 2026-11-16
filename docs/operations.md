# Operación y despliegue

## Migraciones

`0001_initial.sql` crea las tablas, restricciones e índices del SaaS desde cero. No borra ni transforma datos previos. `migrations` guarda las versiones aplicadas; un advisory lock evita aplicar simultáneamente. Cada archivo se ejecuta en una transacción. Aplicar con `pnpm db:migrate` en desarrollo.

Nuevas modificaciones deben ser archivos numerados nuevos. Nunca editar un archivo aplicado. Antes de una migración sobre datos reales: revisar SQL, respaldar, probar sobre una restauración y ejecutar con ventana adecuada. No hay rollback destructivo automático.

## VPS Linux

1. Instalar Docker Engine y Compose. Configurar DNS del dominio al VPS y puertos 80/443.
2. Copiar `infra/.env.example` a `.env` en la raíz. Usar contraseña aleatoria, dominio y credenciales reales de correo. Si la contraseña contiene caracteres reservados, codificarlos en `DATABASE_URL`.
3. `docker compose -f compose.prod.yaml build`
4. `docker compose -f compose.prod.yaml up -d db`
5. `docker compose -f compose.prod.yaml run --rm api node dist/migrate.js`
6. `docker compose -f compose.prod.yaml up -d`
7. Verificar `https://DOMINIO/api/health`, registro/login, correo y flujo completo.

Caddy sirve la web y enruta `/api` a Fastify; obtiene HTTPS automáticamente. PostgreSQL y API no publican puertos del host. Fastify confía únicamente en el primer proxy; mantener API inaccesible directamente. Node corre como usuario no root. La imagen API conserva herramientas de build para simplicidad inicial; separar artefactos/dependencias es una optimización posterior.

Los builds de web y API son independientes. Shared se incluye en ambos. Para actualizar, ejecutar pruebas, construir, aplicar migraciones y recrear los servicios afectados. El despliegue en VPS no ha sido ejecutado por el agente: requiere dominio y secretos del operador.

## Backups y restauración (Linux)

Backup lógico consistente diario, fuera del volumen de PostgreSQL:

```sh
mkdir -p backups
docker compose -f compose.prod.yaml exec -T db pg_dump -U laundry -d laundry -Fc > backups/laundry-$(date +%F).dump
```

Programar con cron, comprobar código de salida y tamaño, cifrar y copiar a almacenamiento externo. Retener al menos siete diarios y cuatro semanales. No confiar solo en snapshots del VPS.

Restaurar primero en una base nueva, nunca sobrescribir la activa durante una prueba:

```sh
docker compose -f compose.prod.yaml exec -T db createdb -U laundry laundry_restore_check
docker compose -f compose.prod.yaml exec -T db pg_restore -U laundry -d laundry_restore_check --no-owner --exit-on-error < backups/laundry-AAAA-MM-DD.dump
docker compose -f compose.prod.yaml exec -T db psql -U laundry -d laundry_restore_check -c "SELECT count(*) FROM orders;"
```

Validar conteos, sumas, relaciones y login con una API de staging apuntando a esa base. Registrar fecha, duración y resultado. En recuperación real, detener escrituras, restaurar a una base nueva y cambiar la conexión después de verificarla. No usar `docker compose down -v` en producción: elimina los volúmenes.

## Mantenimiento

Validación local realizada: backup `pg_dump -Fc` de la base de pruebas y restauración con `pg_restore --exit-on-error` en una base nueva. Conteos y sumas de órdenes/pagos coincidieron; la base temporal de restauración se eliminó después. Esta comprobación local no sustituye la prueba con el almacenamiento externo del VPS.

- Healthcheck HTTP `/api/health`, logs `docker compose -f compose.prod.yaml logs --tail=100 api`, espacio en disco y backups.
- Limpieza diaria: `DELETE FROM sessions WHERE expires_at < now(); DELETE FROM tokens WHERE expires_at < now();` mediante psql en tarea programada.
- No borrar órdenes/pagos/auditoría; archivar con política explícita cuando sea necesario.
- Mantener actualizaciones de Node, PostgreSQL y dependencias controladas con lockfile y pruebas.
- `.env` y backups no se versionan. Probar restauración antes de comenzar el piloto real.
