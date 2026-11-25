-- Requiere PostgreSQL 18. Solo cambia defaults de registros nuevos:
-- los UUIDv4 existentes y todas sus relaciones se conservan.
ALTER TABLE users ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE companies ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE branches ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE customers ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE services ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE orders ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE order_items ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE cash_sessions ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE payments ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE audit ALTER COLUMN id SET DEFAULT uuidv7();

CREATE INDEX order_items_tenant_order ON order_items(company_id, order_id);
CREATE INDEX payments_tenant_order_date ON payments(company_id, order_id, created_at DESC);
CREATE INDEX payments_tenant_cash ON payments(company_id, cash_id) WHERE cash_id IS NOT NULL;
CREATE INDEX customers_tenant_name ON customers(company_id, name);
CREATE INDEX customers_tenant_phone ON customers(company_id, phone) WHERE phone <> '';
CREATE INDEX sessions_user ON sessions(user_id);
