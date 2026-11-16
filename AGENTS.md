# Reglas del proyecto

- Mantener español peruano en la interfaz y respuestas de API. Usar la skill `laundry-ui` al modificar pantallas.
- Stack monolítico modular: Fastify, Drizzle/PostgreSQL, Zod compartido, React/Vite, Tailwind y UI editable. Evitar infraestructura adicional sin necesidad demostrada.
- Cada acceso empresarial pasa por `tenant()` y filtra explícitamente `company_id`. El rol de plataforma solo habilita rutas explícitas auditadas.
- No aceptar precios, saldos ni roles autoritativos desde el navegador. Dinero en céntimos; cantidad con máximo tres decimales.
- Operaciones financieras: transacción, bloqueo empresa → orden → caja, idempotencia y auditoría atómicas. Nunca borrar pagos.
- No cambiar migraciones aplicadas. Añadir SQL numerado nuevo, explicar efectos y respaldar antes de modificar datos reales.
- Las pruebas de integración usan únicamente base `_test`. Desarrollo y producción tienen datos independientes.
- Ejecutar typecheck/build y pruebas relevantes. Para flujo de mostrador, `pnpm test:e2e` después de `pnpm test` con Docker activo.
- No incluir `.env`, secretos, backups ni datos reales en el repositorio. La landing sigue pospuesta.
