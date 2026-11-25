-- Añadidos a pedidos: idempotencia persistente y una línea por servicio.
-- No cambia importes ni elimina registros históricos.
CREATE UNIQUE INDEX order_items_service_once ON order_items(company_id, order_id, service_id);

CREATE TABLE order_additions (
  company_id uuid NOT NULL REFERENCES companies(id),
  request_id uuid NOT NULL,
  order_id uuid NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id, request_id),
  FOREIGN KEY(company_id, order_id) REFERENCES orders(company_id, id)
);
CREATE INDEX order_additions_order ON order_additions(company_id, order_id);
