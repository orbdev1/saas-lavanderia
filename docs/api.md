# Contratos HTTP

Base `/api`. JSON. Escrituras: `Origin` igual a `APP_ORIGIN`. Operaciones empresariales:
cookie `session` y `X-Company-Id`. Los IDs son UUID. Go valida todas las entradas;
los esquemas compartidos Zod validan también los formularios que los utilizan.

Errores: `{ "message": "Descripción", "code": "CÓDIGO_OPCIONAL" }`; 400 entrada,
401 sesión/credenciales, 403 permisos/origen/suscripción/MFA, 404 recurso dentro
del tenant, 409 conflicto/idempotencia, 429 límite, 503 timeout, 500 fallo interno.

| Método | Ruta | Uso |
|---|---|---|
| POST | /auth/register | name, company, email, password; crea tenant y propietario |
| POST | /auth/login, /auth/logout | Iniciar/cerrar sesión |
| GET | /auth/me | Identidad y membresías |
| POST | /auth/forgot | email; devuelve contactos de soporte manual, sin enviar mensajes |
| POST | /auth/reset | token, password |
| POST | /auth/password | currentPassword, password; cambia clave y revoca todas las sesiones |
| GET | /auth/sessions | Sesiones propias activas |
| DELETE | /auth/sessions/:id | Revoca una sesión propia |
| GET | /auth/mfa | Estado MFA de la persona/sesión |
| POST | /auth/mfa/setup | password; devuelve clave TOTP para registrar en autenticador |
| POST | /auth/mfa/enable | code; confirma alta y devuelve códigos de recuperación una vez |
| POST | /auth/mfa/verify | code TOTP o recuperación; verifica esta sesión |
| GET/POST | /customers | Listar/crear |
| GET | /customers/export | CSV de clientes del tenant; propietario/administrador; auditado |
| PUT | /customers/:id | name, phone, document, notes |
| GET/POST | /services | Listar/crear |
| PUT | /services/:id | name, unit, price, minimum, active |
| GET | /orders | search, status, offset |
| POST | /orders | customerId, dueAt ISO, notes, items [{serviceId,quantity,notes?}], requestId, discount?, express?, garmentCount? |
| POST | /orders/:id/services | Agrega cantidades/servicios: items, reason, requestId, expectedTotal, expectedStatus |
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
| POST | /team | name, email, password temporal, role: manager / staff; preserva identidad existente |
| PATCH | /team/:id | role, active, reason; no permite modificar propietario ni acceso propio |
| GET | /platform/companies | Métricas globales auditadas |
| GET | /platform/companies/:id | Equipo, saldos por cliente y últimas órdenes; lectura auditada |
| PATCH | /platform/companies/:id | status, reason; el saldo se calcula desde cuotas/pagos |
| GET | /health | Comprueba conexión de base |

`requestId` se conserva al reintentar la misma orden/pago. Cambiar contenido con la misma clave produce 409. Si necesitas otra operación, genera otro UUID. El servidor calcula precio y saldo; el cliente no envía totales autoritativos.

Las nuevas cantidades tienen máximo dos decimales; si el servicio es por pieza, además
deben ser enteras. Los identificadores de entidad nuevos se generan con `uuidv7()` en
PostgreSQL 18; siguen admitiéndose UUIDv4 existentes y claves de idempotencia UUIDv4.

Los avisos de WhatsApp son enlaces manuales desde la interfaz. Preparar un mensaje
vuelve a consultar `/orders/:id` para usar el saldo vigente; no se registra una entrega
de mensaje que el sistema no puede verificar.

### Agregar servicios al pedido

Permitido a propietario, administrador y empleado de la empresa, solamente en pedidos
recibidos, en proceso o listos. Conserva número, cliente, fecha, pagos y precios
históricos. Un servicio que ya existe suma cantidades y conserva su precio/mínimo;
un servicio distinto usa el catálogo vigente. Un pedido listo vuelve a proceso.
La entrega sigue requiriendo estado listo y saldo cero.

`expectedTotal` y `expectedStatus` son comprobaciones de concurrencia, no valores
autoritativos de cobro. Si cambiaron, responde 409 y debe revisarse el detalle.
El servidor calcula el incremento. `requestId` es único por empresa para añadidos;
el reintento con el mismo contenido devuelve el pedido incluso si luego fue entregado.
Una clave con contenido u orden distintos produce 409. Auditoría, incremento e
idempotencia se confirman juntos en transacción.

## Suscripciones, soporte y plataforma

Todas las rutas `/platform/*` exigen rol de plataforma y MFA verificado en la
sesión actual. Las consultas y modificaciones quedan auditadas.

| Método | Ruta | Entrada / resultado |
|---|---|---|
| GET/POST | /platform/plans | Lista / crea plan con name, monthlyPrice, annualPrice, userLimit?, branchLimit?, active, reason |
| PUT | /platform/plans/:id | Mismos campos; no cambia contratos existentes |
| PUT | /platform/companies/:id/subscription | planId, cycle monthly/annual, anchor YYYY-MM-DD, trialUntil?, userLimit?, branchLimit?, reason |
| POST | /platform/companies/:id/charges | requestId, reason; genera siguiente período por calendario |
| POST | /platform/companies/:id/payments | chargeId, amount, method, reference, paidAt ISO, reason, requestId |
| POST | /platform/companies/:id/reverse-payment | paymentId, reason, requestId; reversión completa, original inmutable |
| POST | /platform/companies/:id/extension | until YYYY-MM-DD exclusivo, reason |
| GET | /platform/finance | Ingresos netos, gastos, saldo y movimientos recientes |
| POST | /platform/expenses | amount, description, paidAt ISO, requestId |
| POST | /platform/users/:id/recovery | reason; enlace privado manual de un uso, 30 minutos |
| GET | /platform/requests | Solicitudes de cupos/exportación |
| POST | /platform/requests/:id/resolve | approve boolean, reason |
| GET | /subscription | Propietario: contrato y cuotas, también suspendido |
| GET | /requests | Propietario: solicitudes de su empresa, también suspendido |
| POST | /requests | kind seats/export/cancel, reason, requestId, seats? u orderId? |
| GET | /requests/:id/export | Propietario: descarga JSON de una exportación aprobada, también suspendido |
| GET | /team/requests | Propietario/administrador: solicitudes de anulación |
| POST | /team/requests/:id/resolve | approve, reason; aprobación anula con las mismas restricciones financieras |

Los importes son céntimos. `discount` solo puede ser positivo para propietario/
administrador y debe ser menor al subtotal. Express no agrega recargo.
La facturación no contiene precios ni cupos predefinidos. Las cuotas se generan
manualmente; cada una conserva su precio/período. La cobertura se extiende solo
por períodos contiguos íntegramente pagados y se recalcula ante reversiones.

Las fechas de fin son exclusivas, evaluadas en America/Lima. El acceso automático
vence al alcanzar cobertura + tres días de gracia, salvo prueba/prórroga mayor.
Una suspensión administrativa tiene prioridad. El propietario conserva las
rutas explícitas de suscripción/portabilidad, sin acceso operativo general.
