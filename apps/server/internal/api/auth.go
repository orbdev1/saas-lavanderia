package api

import (
	"net/http"
	"slices"
	"time"
)

func sessionToken(r *http.Request) string {
	cookie, err := r.Cookie("session")
	if err != nil || len(cookie.Value) != 64 {
		return ""
	}
	return hash(cookie.Value)
}

func (s *Server) authenticate(r *http.Request) Row {
	value := sessionToken(r)
	require(value != "", 401, "Inicia sesión para continuar", "SESSION_EXPIRED")
	user := s.store(r).one(`SELECT u.id,u.name,u.email,u.platform_admin AS "platformAdmin",
		u.must_change_password AS "mustChangePassword",s.id AS "sessionId",s.mfa_verified AS "mfaVerified"
		FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>now()`, value)
	require(user != nil, 401, "Tu sesión ha vencido", "SESSION_EXPIRED")
	return user
}

type Tenant struct {
	Actor                     Row
	CompanyID, BranchID, Role string
}

func (s *Server) tenant(r *http.Request, roles ...string) Tenant {
	actor := s.authenticate(r)
	require(!flag(actor, "mustChangePassword"), 403, "Cambia tu contraseña temporal para continuar", "PASSWORD_CHANGE_REQUIRED")
	company := uid(r.Header.Get("X-Company-Id"))
	member := s.store(r).one(`SELECT m.role,c.status,b.id AS branch,`+subscriptionAllowed+` AS subscribed
		FROM memberships m JOIN companies c ON c.id=m.company_id
		JOIN branches b ON b.company_id=m.company_id
		WHERE m.company_id=$1 AND m.user_id=$2 AND m.active ORDER BY b.id LIMIT 1`, company, str(actor, "id"))
	require(member != nil, 403, "No tienes acceso a esta empresa", "COMPANY_ACCESS_REVOKED")
	require(str(member, "status") == "active", 403, "La suscripción está suspendida; contacta al administrador", "COMPANY_SUSPENDED")
	require(flag(member, "subscribed"), 403, "La suscripción está vencida; contacta al propietario", "COMPANY_SUSPENDED")
	if len(roles) == 0 {
		roles = []string{"owner", "manager", "staff"}
	}
	require(slices.Contains(roles, str(member, "role")), 403, "Tu rol no permite esta acción")
	return Tenant{actor, company, str(member, "branch"), str(member, "role")}
}

func (s *Server) setSession(w http.ResponseWriter, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: "session", Value: value, Path: "/", HttpOnly: true,
		Secure: s.Config.Production, SameSite: http.SameSiteLaxMode, MaxAge: age})
}

func insertSession(db Store, r *http.Request, user, value string) {
	agent := r.UserAgent()
	if len(agent) > 512 {
		agent = agent[:512]
	}
	db.exec(`INSERT INTO sessions(token,user_id,expires_at,user_agent) VALUES($1,$2,now()+interval '7 days',$3)`,
		hash(value), user, agent)
}

func (s *Server) authRoutes(add func(string, string, endpoint)) {
	add("POST", "/auth/register", func(w http.ResponseWriter, r *http.Request) any {
		b := body(r, "name", "company", "email", "password")
		name, company, address := text(b, "name", 2, 100), text(b, "company", 2, 100), email(b)
		password := passwordInput(b, "password")
		s.reserveAttempts(r, map[string]int64{"register-ip:" + hash(s.clientIP(r)): 5})
		var encoded string
		s.passwordWork(r.Context(), func() { encoded = encodePassword(password) })
		value := token()
		s.transaction(r.Context(), func(db Store) any {
			lockBuckets(db, "identity:"+hash(address))
			user := db.one(`INSERT INTO users(name,email,password) VALUES($1,$2,$3) RETURNING id`, name, address, encoded)
			companyID := str(db.one(`INSERT INTO companies(name) VALUES($1) RETURNING id`, company), "id")
			userID := str(user, "id")
			db.exec(`INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'owner')`, companyID, userID)
			db.exec(`INSERT INTO branches(company_id,name) VALUES($1,'Principal')`, companyID)
			db.exec(`INSERT INTO services(company_id,name,unit,price,minimum) VALUES
				($1,'Lavado de ropa','kg',600,3),($1,'Edredón','piece',2500,1),($1,'Lavado en seco','piece',1500,1)`, companyID)
			insertSession(db, r, userID, value)
			db.audit(userID, companyID, "company.registered", companyID, Row{})
			return nil
		})
		s.setSession(w, value, 7*24*60*60)
		return created{Row{"ok": true}}
	})
	add("POST", "/auth/login", func(w http.ResponseWriter, r *http.Request) any {
		b := body(r, "email", "password")
		address, password := email(b), passwordInput(b, "password")
		s.reserveAttempts(r, map[string]int64{"email:" + hash(address): 10, "ip:" + hash(s.clientIP(r)): 50})
		user := s.store(r).one(`SELECT id,password FROM users WHERE email=$1`, address)
		valid := false
		s.passwordWork(r.Context(), func() {
			if user == nil {
				encodePassword(password)
			} else {
				valid = verifyPassword(str(user, "password"), password)
			}
		})
		require(valid, 401, "Correo o contraseña incorrectos")
		value := token()
		s.transaction(r.Context(), func(db Store) any {
			// A password change during verification must invalidate this login attempt.
			current := db.one(`SELECT password FROM users WHERE id=$1 FOR UPDATE`, str(user, "id"))
			require(str(current, "password") == str(user, "password"), 401, "Correo o contraseña incorrectos")
			insertSession(db, r, str(user, "id"), value)
			db.audit(str(user, "id"), "", "session.created", "", Row{})
			return nil
		})
		s.setSession(w, value, 7*24*60*60)
		return Row{"ok": true}
	})
	add("POST", "/auth/logout", func(w http.ResponseWriter, r *http.Request) any {
		s.store(r).exec(`DELETE FROM sessions WHERE token=$1`, sessionToken(r))
		s.setSession(w, "", -1)
		return Row{"ok": true}
	})
	add("GET", "/auth/me", func(w http.ResponseWriter, r *http.Request) any {
		user := s.authenticate(r)
		user["memberships"] = s.store(r).rows(`SELECT m.company_id AS "companyId",c.name AS "companyName",m.role,
			CASE WHEN c.status='active' AND `+subscriptionAllowed+` THEN 'active' ELSE 'suspended' END AS status
			FROM memberships m JOIN companies c ON c.id=m.company_id
			WHERE m.user_id=$1 AND m.active ORDER BY c.name`, str(user, "id"))
		return user
	})
	add("GET", "/auth/sessions", func(w http.ResponseWriter, r *http.Request) any {
		user := s.authenticate(r)
		return s.store(r).rows(`SELECT id,created_at AS "createdAt",expires_at AS "expiresAt",
			user_agent AS "userAgent",(token=$2) AS current FROM sessions
			WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC`, str(user, "id"), sessionToken(r))
	})
	add("DELETE", "/auth/sessions/{id}", func(w http.ResponseWriter, r *http.Request) any {
		user, id := s.authenticate(r), pathID(r)
		return s.transaction(r.Context(), func(db Store) any {
			row := db.one(`DELETE FROM sessions WHERE user_id=$1 AND id=$2 RETURNING id`, str(user, "id"), id)
			require(row != nil, 404, "Sesión no encontrada")
			db.audit(str(user, "id"), "", "session.revoked", id, Row{})
			return Row{"ok": true}
		})
	})
	add("POST", "/auth/password", func(w http.ResponseWriter, r *http.Request) any {
		user := s.authenticate(r)
		b := body(r, "currentPassword", "password")
		current, next := passwordInput(b, "currentPassword"), passwordInput(b, "password")
		require(current != next, 400, "Elige una contraseña diferente")
		s.reserveAttempts(r, map[string]int64{"password:" + str(user, "id"): 10})
		before := s.store(r).one(`SELECT password FROM users WHERE id=$1`, str(user, "id"))
		var encoded string
		s.passwordWork(r.Context(), func() {
			require(verifyPassword(str(before, "password"), current), 401, "Contraseña actual incorrecta")
			encoded = encodePassword(next)
		})
		s.transaction(r.Context(), func(db Store) any {
			locked := db.one(`SELECT password FROM users WHERE id=$1 FOR UPDATE`, str(user, "id"))
			require(str(locked, "password") == str(before, "password"), 409, "La contraseña cambió. Inicia sesión nuevamente.")
			active := db.one(`SELECT id FROM sessions WHERE token=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE`,
				sessionToken(r), str(user, "id"))
			require(active != nil, 401, "Tu sesión ha vencido")
			db.exec(`UPDATE users SET password=$1,must_change_password=false WHERE id=$2`, encoded, str(user, "id"))
			db.exec(`DELETE FROM sessions WHERE user_id=$1`, str(user, "id"))
			db.exec(`DELETE FROM tokens WHERE email=$1 AND kind='reset'`, str(user, "email"))
			db.audit(str(user, "id"), "", "password.changed", str(user, "id"), Row{"revokedAt": time.Now().UTC()})
			return nil
		})
		s.setSession(w, "", -1)
		return Row{"ok": true}
	})
	add("POST", "/auth/forgot", func(w http.ResponseWriter, r *http.Request) any {
		email(body(r, "email"))
		return Row{"ok": true, "message": "Contacta a soporte para recuperar tu acceso.",
			"whatsapp": "https://wa.me/51946561987", "email": "ing.ryqm@gmail.com"}
	})
}
