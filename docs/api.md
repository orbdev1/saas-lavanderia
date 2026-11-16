# Contratos HTTP

Base `/api`. JSON. Escrituras: `Origin` igual a `APP_ORIGIN`. Operaciones empresariales: cookie `session` y `X-Company-Id`. Los IDs son UUID. Las validaciones exactas están en `packages/shared/src/index.ts`.

Errores: `{ "message": "Descripción" }`; 400 entrada, 401 sesión, 403 permisos/origen/suscripción, 404 recurso dentro del tenant, 409 conflicto financiero/idempotencia, 429 límite, 500 fallo interno.

| Método | Ruta | Uso |
|---|---|---|
| POST | /auth/register | name, company, email, password; crea tenant y propietario |
| POST | /auth/login, /auth/logout | Iniciar/cerrar sesión |
| GET | /auth/me | Identidad y membresías |
| POST | /auth/forgot | email; envía recuperación |
| POST | /auth/reset | token, password |
| POST | /auth/accept | token, name, email, password; acepta invitación |
| GET/POST | /customers | Listar/crear |
| PUT | /customers/:id | name, phone, document, notes |
| GET/POST | /services | Listar/crear |
| PUT | /services/:id | name, unit, price, minimum, active |
| GET | /orders | search, status, offset |
| POST | /orders | customerId, dueAt ISO, notes, items [{serviceId,quantity}], requestId |
| GET | /orders/:id | Cabecera, ítems históricos y pagos |
| PATCH | /orders/:id/status | status: processing / ready / delivered |
| PATCH | /orders/:id | dueAt, notes, reason |
| POST | /orders/:id/payments | amount céntimos, method, reference, requestId |
| POST | /orders/:id/refunds | amount positivo céntimos, method, reason, requestId |
| POST | /orders/:id/cancel | reason |
| GET | /cash | Historial y esperado |
| POST | /cash/open | opening céntimos |
| POST | /cash/:id/close | counted céntimos |
| GET | /reports | Totales acumulados |
| GET | /reports/export | CSV |
| GET | /audit | Eventos auditados |
| GET | /team | Miembros |
| POST | /team/invite | email, role: manager / staff |
| DELETE | /team/:id | Quitar acceso de no propietario |
| GET | /platform/companies | Métricas globales auditadas |
| GET | /platform/companies/:id | Equipo, saldos por cliente y últimas órdenes; lectura auditada |
| PATCH | /platform/companies/:id | status, subscriptionDue céntimos, reason |
| GET | /health | Comprueba conexión de base |

`requestId` se conserva al reintentar la misma orden/pago. Cambiar contenido con la misma clave produce 409. Si necesitas otra operación, genera otro UUID. El servidor calcula precio y saldo; el cliente no envía totales autoritativos.
