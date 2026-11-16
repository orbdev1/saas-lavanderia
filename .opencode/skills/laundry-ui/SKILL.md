---
name: Laundry UI
description: Diseñar y modificar pantallas del SaaS de lavanderías con React, Tailwind y componentes shadcn/ui, priorizando operaciones de mostrador accesibles.
---

1. Identificar tarea principal, rol y estados vacío, carga, error y éxito.
2. Reutilizar components/ui y los tokens de styles.css. Mantener español peruano, importes PEN y fecha America/Lima.
3. Mantener una acción principal por sección; controles táctiles de al menos 44px y foco visible.
4. Etiquetar inputs, usar HTML semántico y diálogos con foco atrapado, Escape y devolución del foco.
5. No comunicar estado solo por color. Mostrar total, cobrado y saldo por separado.
6. Prevenir doble envío; mantener clave de idempotencia en reintentos del mismo formulario financiero.
7. Verificar teclado y anchos 360px, 768px y escritorio; tablas deben tener desplazamiento propio.
8. Mantener impresión de tickets legible y sin controles. No llamar comprobante fiscal al ticket de servicio.
9. Ejecutar typecheck/build y probar flujo real para cambios de lógica.
