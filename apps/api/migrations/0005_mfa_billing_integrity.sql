-- Aditiva: no altera pagos ni credenciales existentes.
CREATE TABLE mfa_enrollments (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  encrypted_secret text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
ALTER TABLE subscription_charges ADD COLUMN request_hash text;
CREATE UNIQUE INDEX subscription_payment_reversal_once
  ON subscription_payments(company_id,reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX subscriptions_coverage ON subscriptions(covered_until);
