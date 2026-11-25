ALTER TABLE memberships ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE memberships ADD COLUMN disabled_at timestamptz;
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN totp_secret text;
ALTER TABLE users ADD COLUMN totp_last_step bigint NOT NULL DEFAULT -1;
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT uuidv7() UNIQUE;
ALTER TABLE sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN user_agent text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN mfa_verified boolean NOT NULL DEFAULT false;
CREATE TABLE login_limits (
  bucket text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(), blocked_until timestamptz
);
CREATE TABLE recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id), code_hash text NOT NULL,
  PRIMARY KEY(user_id,code_hash)
);
ALTER TABLE orders ADD COLUMN discount integer NOT NULL DEFAULT 0 CHECK(discount>=0);
ALTER TABLE orders ADD COLUMN subtotal integer GENERATED ALWAYS AS (total+discount) STORED;
ALTER TABLE orders ADD COLUMN express boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN garment_count integer CHECK(garment_count BETWEEN 0 AND 10000);
ALTER TABLE order_items ADD COLUMN notes text NOT NULL DEFAULT '';

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT uuidv7(), name text NOT NULL,
  monthly_price integer NOT NULL CHECK(monthly_price>=0),
  annual_price integer NOT NULL CHECK(annual_price>=0),
  user_limit integer CHECK(user_limit>=1), branch_limit integer CHECK(branch_limit>=1),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE subscriptions (
  company_id uuid PRIMARY KEY REFERENCES companies(id), plan_id uuid REFERENCES plans(id),
  cycle text NOT NULL DEFAULT 'monthly' CHECK(cycle IN ('monthly','annual')),
  price integer NOT NULL DEFAULT 0 CHECK(price>=0), anchor date NOT NULL,
  next_charge_start date NOT NULL, covered_until date NOT NULL,
  trial_until date, grace_days integer NOT NULL DEFAULT 3 CHECK(grace_days BETWEEN 0 AND 30),
  extension_until date, user_limit integer CHECK(user_limit>=1), branch_limit integer CHECK(branch_limit>=1)
);
CREATE TABLE subscription_charges (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES companies(id),
  period_start date NOT NULL, period_end date NOT NULL CHECK(period_end>period_start),
  total integer NOT NULL CHECK(total>0), paid integer NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=total),
  request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id), UNIQUE(company_id,period_start), UNIQUE(company_id,request_id)
);
CREATE TABLE subscription_payments (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES companies(id),
  charge_id uuid NOT NULL, amount integer NOT NULL CHECK(amount<>0),
  method text NOT NULL CHECK(method IN ('cash','yape','plin','card','transfer')),
  reference text NOT NULL DEFAULT '', paid_at timestamptz NOT NULL, reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL, request_hash text NOT NULL,
  reverses_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id), UNIQUE(company_id,request_id),
  FOREIGN KEY(company_id,charge_id) REFERENCES subscription_charges(company_id,id),
  FOREIGN KEY(company_id,reverses_id) REFERENCES subscription_payments(company_id,id),
  CHECK(amount>0 OR reverses_id IS NOT NULL)
);
CREATE TABLE platform_expenses (
  id uuid PRIMARY KEY DEFAULT uuidv7(), amount integer NOT NULL CHECK(amount>0),
  description text NOT NULL, paid_at timestamptz NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL UNIQUE, request_hash text NOT NULL
);
CREATE TABLE company_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES companies(id),
  kind text NOT NULL CHECK(kind IN ('seats','export','cancel')),
  order_id uuid, requested_by uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
  seats integer CHECK(seats>0), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
  resolution text, resolved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, request_id uuid NOT NULL, request_hash text NOT NULL,
  UNIQUE(company_id,request_id), FOREIGN KEY(company_id,order_id) REFERENCES orders(company_id,id)
);
CREATE UNIQUE INDEX pending_cancellation_once ON company_requests(company_id,order_id) WHERE kind='cancel' AND state='pending';
CREATE INDEX company_requests_state ON company_requests(company_id,state,created_at);
CREATE INDEX subscription_payments_date ON subscription_payments(paid_at);
