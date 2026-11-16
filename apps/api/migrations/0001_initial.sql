CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
  password text NOT NULL, platform_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  subscription_due integer NOT NULL DEFAULT 0 CHECK(subscription_due >= 0), next_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, UNIQUE(company_id,id));
CREATE TABLE memberships (company_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('owner','manager','staff')), PRIMARY KEY(company_id,user_id));
CREATE TABLE sessions (token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE tokens (token text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('reset','invite')), email text NOT NULL, company_id uuid REFERENCES companies(id), role text, expires_at timestamptz NOT NULL);
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, phone text NOT NULL DEFAULT '', document text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', UNIQUE(company_id,id)
);
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL,
  unit text NOT NULL CHECK(unit IN ('kg','piece')), price integer NOT NULL CHECK(price>0), minimum numeric(12,3) NOT NULL CHECK(minimum>=0), active boolean NOT NULL DEFAULT true, UNIQUE(company_id,id)
);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), branch_id uuid NOT NULL, customer_id uuid NOT NULL,
  number integer NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','processing','ready','delivered','cancelled')),
  total integer NOT NULL CHECK(total>=0), paid integer NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=total),
  due_at timestamptz NOT NULL, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id), UNIQUE(company_id,number), UNIQUE(company_id,request_id),
  FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
  FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
  CHECK(status <> 'delivered' OR paid=total), CHECK(status <> 'cancelled' OR paid=0)
);
CREATE INDEX orders_tenant_created ON orders(company_id,created_at DESC);
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, order_id uuid NOT NULL, service_id uuid NOT NULL,
  name text NOT NULL, unit text NOT NULL, actual numeric(12,3) NOT NULL CHECK(actual>0), charged numeric(12,3) NOT NULL CHECK(charged>=actual), price integer NOT NULL CHECK(price>0), total integer NOT NULL CHECK(total>=0),
  FOREIGN KEY(company_id,order_id) REFERENCES orders(company_id,id), FOREIGN KEY(company_id,service_id) REFERENCES services(company_id,id)
);
CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, opened_by uuid NOT NULL REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, opening integer NOT NULL CHECK(opening>=0), counted integer CHECK(counted>=0), expected integer,
  UNIQUE(company_id,id), FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id)
);
CREATE UNIQUE INDEX one_open_cash ON cash_sessions(company_id,branch_id) WHERE closed_at IS NULL;
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, order_id uuid NOT NULL, cash_id uuid,
  amount integer NOT NULL CHECK(amount<>0), method text NOT NULL CHECK(method IN ('cash','yape','plin','card','transfer')),
  reference text NOT NULL DEFAULT '', reason text, request_id uuid NOT NULL, request_hash text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,request_id), FOREIGN KEY(company_id,order_id) REFERENCES orders(company_id,id), FOREIGN KEY(company_id,cash_id) REFERENCES cash_sessions(company_id,id),
  CHECK(method <> 'cash' OR cash_id IS NOT NULL), CHECK(amount>0 OR reason IS NOT NULL)
);
CREATE TABLE audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id), actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, entity_id uuid, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_date ON audit(company_id,created_at DESC);
