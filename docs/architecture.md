# Arquitectura y reglas de negocio

## Implementación

- Monolito modular Go: autenticación, MFA, equipo, operaciones, pagos, reportes, plataforma, facturación y solicitudes en `apps/server/internal/api`. Contratos públicos en shared; SQL solo en servidor.
- pgx ejecuta SQL parametrizado dentro de transacciones. Las migraciones SQL numeradas son la fuente del esquema, sin sincronización automática ni `push` destructivo. Fastify/Drizzle se conservan como referencia histórica.
- Una empresa posee sedes, catálogo, clientes, órdenes y cajas. Se crea una sede Principal. La UI opera una sede; las claves compuestas preparan relaciones para expansión.
- La sesión es un token aleatorio de 256 bits, guardado como SHA-256 en PostgreSQL, duración absoluta de siete días. Cookie HttpOnly/SameSite, Secure en producción. Argon2id protege contraseñas.
- Todas las escrituras de navegador requieren `Origin` exacto. Autenticación con límite de intentos; no se registran contraseñas ni cuerpos de login.
- El header `X-Company-Id` selecciona contexto, pero la API consulta siempre membresía y estado de empresa. El superadmin **no** obtiene acceso implícito a endpoints operativos; tiene endpoints explícitos y auditados.
- Clientes, servicios, ítems, órdenes y pagos tienen claves foráneas compuestas por empresa. Evitan relaciones entre tenants incluso ante errores de código.

## RLS: evaluación inicial

Este MVP usa autorización central, filtros de empresa obligatorios, claves compuestas y pruebas de aislamiento. RLS no está activado: añadirlo correctamente exige contexto transaccional en todas las consultas y un rol de aplicación sin BYPASSRLS. Activarlo parcialmente daría una falsa garantía. Antes de incorporar nuevas vías de acceso a datos, evaluar esa defensa adicional con pruebas del pool, roles separados y migración específica. No exponer PostgreSQL a los clientes.

## Dinero y cantidades

- PEN en céntimos enteros. Un precio `600` significa S/6.00.
- Cantidades nuevas: kilos con máximo dos decimales y piezas enteras. Se conserva la precisión histórica de tres decimales. Se agrupa por servicio antes del mínimo; total de línea redondeado al céntimo una vez.
- Blancos y colores pueden ser servicios distintos, cada uno con su propio mínimo.
- Piezas enteras. Mínimo configurable por servicio, `0` lo desactiva.
- La orden conserva nombre, unidad, precio, peso real, cantidad cobrada y total históricos.
- Se pueden añadir cantidades/servicios a pedidos abiertos, conservando número y abonos. Repetidos mantienen precio y mínimo originales; nuevos usan catálogo vigente. El descuento inicial se conserva. Reducciones: devolver anticipos → anular → crear otra orden. Fecha y notas requieren motivo autorizado.

## Flujo e integridad

`received → processing → ready → delivered`. La entrega exige saldo cero tanto en API como en CHECK de base de datos. Añadir servicios a un pedido listo lo devuelve a proceso. No hay entrega parcial ni crédito al entregar.

Pagos manuales: efectivo, Yape, Plin, tarjeta y transferencia. Sin integración con billeteras. Varios abonos permitidos; no se acepta sobrepago. Una devolución es un movimiento negativo con motivo, nunca un borrado. Solo antes de entrega y como máximo el cobrado neto. Anulación exige cero cobrado y nunca se aplica a órdenes entregadas.

Crear órdenes y registrar dinero bloquea primero la fila de empresa; luego la orden y, si corresponde, caja. Esa serialización breve por empresa simplifica numeración y carreras de pagos/cierre. `requestId` único por empresa + hash del contenido hace reintentos idempotentes y detecta reutilización con otro contenido. Todos los cambios financieros y su auditoría se confirman juntos.

Caja inicial + cobros en efectivo − devoluciones en efectivo = esperado. Los medios digitales no incrementan efectivo. Una caja abierta por sede; solo administrador/propietario puede cerrar. La diferencia contada queda registrada.

## Permisos

| Acción | Mostrador | Administrador | Propietario | Plataforma |
|---|---|---|---|---|
| Clientes, órdenes, cobrar, estados, abrir caja | Sí | Sí | Sí | Solo con membresía |
| Catálogo, devoluciones, anulación, correcciones, cierre | No | Sí | Sí | Solo con membresía |
| CSV, auditoría y ver equipo | No | Sí | Sí | Solo con membresía |
| Agregar/desactivar empleados | No | Sí | Sí | Solo con membresía |
| Métricas globales / suscripciones | No | No | No | Sí |

Desactivar una membresía invalida el acceso en la siguiente solicitud. Las
transacciones empresariales vuelven a comprobar permisos tras bloquear la empresa.
El propietario no puede desactivarse ni degradarse desde estas rutas.
Los enlaces de recuperación son de un uso y duran 30 minutos; el cambio revoca
sesiones y otros enlaces. Se entregan por contacto manual. Plataforma exige MFA
por sesión; secretos TOTP cifrados y códigos de recuperación almacenados como hashes.

## Alcance y límites explícitos

- Dashboard acumulado; exportación de clientes y órdenes desde Configuración (importes de órdenes en céntimos), últimos 200 eventos de auditoría, últimas 50 cajas.
- Pedidos paginados por 100 en cada estado; autocompletado de clientes en servidor hasta 30 coincidencias, con búsqueda literal y aislamiento.
- Cuotas emitidas manualmente por calendario; pagos manuales, sin procesador automático. Gracia de tres días y prórrogas auditadas; cobertura y suspensión se evalúan en cada solicitud. Las fechas de cobertura/prórroga son exclusivas en America/Lima.
- Tickets no fiscales; se usa impresión del navegador. Mensajes de WhatsApp son enlaces manuales.
- Sesiones y tokens vencidos se limpian con la tarea SQL de operaciones.
- Pendiente de validar con el negocio: precios reales, reglas de reclamos después de entrega, formato físico de impresora y política comercial de suscripciones.
- Fuera de este alcance: SUNAT, entrega a domicilio, múltiples sedes operativas, inventario, fidelización, offline, lectura de Yape y landing.

La instalación del VPS, el dominio, backups externos y la restauración en
infraestructura remota corresponden al despliegue futuro. No se requiere proveedor de correo.
