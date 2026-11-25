-- Run as the migration owner, after all migrations, in the selected database.
-- Create laundry_app with an independently generated password before this script.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO laundry_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO laundry_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO laundry_app;
REVOKE ALL ON migrations FROM laundry_app;
REVOKE UPDATE ON payments, audit, order_additions, subscription_payments, platform_expenses FROM laundry_app;
REVOKE INSERT, UPDATE ON users FROM laundry_app;
GRANT INSERT(name,email,password,must_change_password) ON users TO laundry_app;
GRANT UPDATE(name,email,password,must_change_password,totp_secret,totp_last_step) ON users TO laundry_app;
GRANT DELETE ON sessions,tokens,recovery_codes,mfa_enrollments,login_limits TO laundry_app;
-- No DELETE/TRUNCATE on financial records or audit; no DDL or platform-role updates.
