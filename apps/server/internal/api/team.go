package api

import "net/http"

// Recheck membership and session after locking the company, so a concurrent
// deactivation cannot authorize a later team mutation from a stale precheck.
func authorizeTeam(db Store, r *http.Request, tenant Tenant) {
	row := db.one(`SELECT m.role,c.status,`+subscriptionAllowed+` AS subscribed FROM memberships m
		JOIN companies c ON c.id=m.company_id JOIN users u ON u.id=m.user_id
		JOIN sessions s ON s.user_id=m.user_id
		WHERE m.company_id=$1 AND m.user_id=$2 AND m.active
		AND s.token=$3 AND s.expires_at>now() AND NOT u.must_change_password`,
		tenant.CompanyID, str(tenant.Actor, "id"), sessionToken(r))
	require(row != nil && flag(row, "subscribed") && str(row, "status") == "active" &&
		(str(row, "role") == "owner" || str(row, "role") == "manager"), 403, "Ya no tienes permiso para administrar este equipo")
}

func checkSeat(db Store, company string) {
	limit := db.one(`SELECT user_limit FROM subscriptions WHERE company_id=$1`, company)
	if limit != nil && limit["user_limit"] != nil {
		count := db.one(`SELECT count(*) AS count FROM memberships WHERE company_id=$1 AND active`, company)
		require(num(count, "count") < num(limit, "user_limit"), 409, "Alcanzaste el cupo de usuarios. Solicita una ampliación.", "SEAT_LIMIT")
	}
}

func (s *Server) teamRoutes(add func(string, string, endpoint)) {
	add("GET", "/team", func(w http.ResponseWriter, r *http.Request) any {
		tenant := s.tenant(r, "owner", "manager")
		return s.store(r).rows(`SELECT u.id,u.name,u.email,m.role,m.active,m.disabled_at AS "disabledAt"
			FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY u.name`, tenant.CompanyID)
	})
	add("POST", "/team", func(w http.ResponseWriter, r *http.Request) any {
		tenant := s.tenant(r, "owner", "manager")
		b := body(r, "name", "email", "password", "role")
		name, address, role := text(b, "name", 2, 100), email(b), text(b, "role", 1, 20)
		require(role == "staff" || role == "manager", 400, "Rol inválido")
		password := passwordInput(b, "password")
		var encoded string
		s.passwordWork(r.Context(), func() { encoded = encodePassword(password) })
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, tenant.CompanyID)
			authorizeTeam(db, r, tenant)
			checkSeat(db, tenant.CompanyID)
			// Serialize the same identity across different companies without changing
			// its name, password or memberships in any other company.
			lockBuckets(db, "identity:"+hash(address))
			user := db.one(`SELECT id FROM users WHERE email=$1`, address)
			existing := user != nil
			if !existing {
				user = db.one(`INSERT INTO users(name,email,password,must_change_password) VALUES($1,$2,$3,true) RETURNING id`, name, address, encoded)
			}
			id := str(user, "id")
			member := db.one(`SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2`, tenant.CompanyID, id)
			require(member == nil, 409, "Esta persona ya pertenece al equipo; revisa su estado")
			db.exec(`INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,$3)`, tenant.CompanyID, id, role)
			db.audit(str(tenant.Actor, "id"), tenant.CompanyID, "member.created", id, Row{"role": role, "existingIdentity": existing})
			message := "Entrega la contraseña temporal personalmente. Deberá cambiarla al ingresar."
			if existing {
				message = "La persona conserva su contraseña y sus datos de acceso existentes."
			}
			return created{Row{"id": id, "existingIdentity": existing, "message": message}}
		})
	})
	add("PATCH", "/team/{id}", func(w http.ResponseWriter, r *http.Request) any {
		tenant, id := s.tenant(r, "owner", "manager"), pathID(r)
		b := body(r, "role", "active", "reason")
		role, reason := text(b, "role", 1, 20), text(b, "reason", 5, 500)
		require(role == "staff" || role == "manager", 400, "Rol inválido")
		_, hasActive := b["active"]
		require(hasActive, 400, "Indica el estado del empleado")
		active := boolean(b, "active")
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, tenant.CompanyID)
			authorizeTeam(db, r, tenant)
			before := db.one(`SELECT role,active FROM memberships WHERE company_id=$1 AND user_id=$2 FOR UPDATE`, tenant.CompanyID, id)
			require(before != nil, 404, "Empleado no encontrado")
			require(str(before, "role") != "owner", 403, "No puedes modificar ni desactivar al propietario")
			require(id != str(tenant.Actor, "id"), 403, "No puedes cambiar tu propio acceso")
			if active && !flag(before, "active") {
				checkSeat(db, tenant.CompanyID)
			}
			db.exec(`UPDATE memberships SET role=$3,active=$4,disabled_at=CASE WHEN $4 THEN NULL ELSE now() END
				WHERE company_id=$1 AND user_id=$2`, tenant.CompanyID, id, role, active)
			db.audit(str(tenant.Actor, "id"), tenant.CompanyID, "member.updated", id, Row{
				"before": before, "after": Row{"role": role, "active": active}, "reason": reason})
			return Row{"ok": true}
		})
	})
}
