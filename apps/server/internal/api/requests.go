package api

import "net/http"

// Ownership remains verifiable while suspended, permitting portability requests.
func (s *Server) ownerEvenSuspended(r *http.Request) Tenant {
	actor := s.authenticate(r)
	require(!flag(actor, "mustChangePassword"), 403, "Cambia tu contraseña temporal", "PASSWORD_CHANGE_REQUIRED")
	id := uid(r.Header.Get("X-Company-Id"))
	row := s.store(r).one(`SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2 AND active`, id, str(actor, "id"))
	require(row != nil && str(row, "role") == "owner", 403, "Acceso exclusivo del propietario")
	return Tenant{Actor: actor, CompanyID: id, Role: "owner"}
}
func (s *Server) requestRoutes(add func(string, string, endpoint)) {
	add("GET", "/subscription", func(w http.ResponseWriter, r *http.Request) any {
		t := s.ownerEvenSuspended(r)
		db := s.store(r)
		return Row{"company": db.one(`SELECT c.id,c.name,c.status,`+subscriptionAllowed+` AS subscribed,c.subscription_due AS "subscriptionDue" FROM companies c WHERE c.id=$1`, t.CompanyID),
			"subscription": db.one(`SELECT s.cycle,s.price,s.anchor::text,s.covered_until::text AS "coveredUntil",s.trial_until::text AS "trialUntil",
				s.extension_until::text AS "extensionUntil",s.grace_days AS "graceDays",s.user_limit AS "userLimit",s.branch_limit AS "branchLimit",p.name AS plan
				FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE s.company_id=$1`, t.CompanyID),
			"charges": db.rows(`SELECT id,period_start::text AS "periodStart",period_end::text AS "periodEnd",total,paid FROM subscription_charges WHERE company_id=$1 ORDER BY period_start DESC`, t.CompanyID)}
	})
	add("GET", "/requests", func(w http.ResponseWriter, r *http.Request) any {
		t := s.ownerEvenSuspended(r)
		return s.store(r).rows(`SELECT id,kind,reason,seats,state,resolution,created_at AS "createdAt" FROM company_requests WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200`, t.CompanyID)
	})
	add("POST", "/requests", func(w http.ResponseWriter, r *http.Request) any {
		b := body(r, "kind", "reason", "seats", "orderId", "requestId")
		kind, reason, requestID := text(b, "kind", 1, 20), text(b, "reason", 5, 500), uid(text(b, "requestId", 1, 40))
		require(kind == "seats" || kind == "export" || kind == "cancel", 400, "Solicitud inválida")
		var t Tenant
		var seats, order any
		if kind == "cancel" {
			t = s.tenant(r)
			order = uid(text(b, "orderId", 1, 40))
		} else {
			t = s.ownerEvenSuspended(r)
		}
		if kind == "seats" {
			seats = integer(b, "seats", 1, 1000)
		}
		fp := fingerprint(b)
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, t.CompanyID)
			member := db.one(`SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2 AND active`, t.CompanyID, str(t.Actor, "id"))
			require(member != nil && (kind == "cancel" || str(member, "role") == "owner"), 403, "Tu acceso cambió")
			previous := db.one(`SELECT id,request_hash FROM company_requests WHERE company_id=$1 AND request_id=$2`, t.CompanyID, requestID)
			if previous != nil {
				require(str(previous, "request_hash") == fp, 409, "Solicitud reutilizada")
				return Row{"id": previous["id"]}
			}
			if kind == "cancel" {
				row := lockedOrder(db, t.CompanyID, order.(string))
				openOrder(row)
			}
			row := db.one(`INSERT INTO company_requests(company_id,kind,order_id,requested_by,reason,seats,request_id,request_hash)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, t.CompanyID, kind, order, str(t.Actor, "id"), reason, seats, requestID, fp)
			db.audit(str(t.Actor, "id"), t.CompanyID, "request.created", str(row, "id"), Row{"kind": kind, "reason": reason})
			return row
		})
	})
	add("GET", "/team/requests", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r, "owner", "manager")
		return s.store(r).rows(`SELECT id,order_id AS "orderId",reason,state,created_at AS "createdAt" FROM company_requests WHERE company_id=$1 AND kind='cancel' ORDER BY created_at DESC LIMIT 100`, t.CompanyID)
	})
	add("POST", "/team/requests/{id}/resolve", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.tenant(r, "owner", "manager"), pathID(r)
		b := body(r, "approve", "reason")
		approved, reason := boolean(b, "approve"), text(b, "reason", 5, 500)
		return s.companyWrite(r, t, []string{"owner", "manager"}, func(db Store) any {
			request := db.one(`SELECT order_id,state FROM company_requests WHERE company_id=$1 AND id=$2 AND kind='cancel' FOR UPDATE`, t.CompanyID, id)
			require(request != nil, 404, "Solicitud no encontrada")
			require(str(request, "state") == "pending", 409, "Solicitud ya resuelta")
			state := "rejected"
			if approved {
				cancelOrder(db, t, str(request, "order_id"), reason)
				state = "approved"
			}
			resolveRequest(db, t.CompanyID, id, str(t.Actor, "id"), state, reason)
			return Row{"ok": true}
		})
	})
	add("GET", "/platform/requests", func(w http.ResponseWriter, r *http.Request) any {
		actor := s.platform(r)
		db := s.store(r)
		db.audit(str(actor, "id"), "", "platform.requests.viewed", "", Row{})
		return db.rows(`SELECT q.id,q.company_id AS "companyId",c.name AS company,q.kind,q.reason,q.seats,q.state,q.created_at AS "createdAt"
			FROM company_requests q JOIN companies c ON c.id=q.company_id WHERE q.kind<>'cancel' ORDER BY q.created_at DESC LIMIT 200`)
	})
	add("POST", "/platform/requests/{id}/resolve", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		b := body(r, "approve", "reason")
		approved, reason := boolean(b, "approve"), text(b, "reason", 5, 500)
		return s.transaction(r.Context(), func(db Store) any {
			request := db.one(`SELECT company_id FROM company_requests WHERE id=$1 AND kind<>'cancel'`, id)
			require(request != nil, 404, "Solicitud no encontrada")
			company := str(request, "company_id")
			companyLock(db, company)
			request = db.one(`SELECT kind,seats,state FROM company_requests WHERE company_id=$1 AND id=$2 FOR UPDATE`, company, id)
			require(str(request, "state") == "pending", 409, "Solicitud ya resuelta")
			if approved && str(request, "kind") == "seats" {
				sub := db.one(`SELECT user_limit FROM subscriptions WHERE company_id=$1 FOR UPDATE`, company)
				require(sub != nil, 409, "Configura la suscripción primero")
				base := num(sub, "user_limit")
				if sub["user_limit"] == nil {
					base = num(db.one(`SELECT count(*) AS count FROM memberships WHERE company_id=$1 AND active`, company), "count")
				}
				db.exec(`UPDATE subscriptions SET user_limit=$2 WHERE company_id=$1`, company, base+num(request, "seats"))
			}
			state := "rejected"
			if approved {
				state = "approved"
			}
			resolveRequest(db, company, id, str(actor, "id"), state, reason)
			return Row{"ok": true}
		})
	})
	add("GET", "/requests/{id}/export", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.ownerEvenSuspended(r), pathID(r)
		result := s.transaction(r.Context(), func(db Store) any {
			companyLock(db, t.CompanyID)
			request := db.one(`SELECT id FROM company_requests WHERE company_id=$1 AND id=$2 AND kind='export' AND state='approved'`, t.CompanyID, id)
			require(request != nil, 403, "La exportación necesita una solicitud aprobada")
			data := Row{}
			for _, table := range []string{"customers", "services", "orders", "order_items", "payments", "cash_sessions", "branches"} {
				data[table] = db.rows(`SELECT * FROM `+table+` WHERE company_id=$1`, t.CompanyID)
			}
			// Internal request fingerprints and tenant keys are not credentials.
			db.audit(str(t.Actor, "id"), t.CompanyID, "company.data_exported", id, Row{})
			return data
		})
		w.Header().Set("Content-Disposition", `attachment; filename="datos-lavanderia.json"`)
		return result
	})
}
func resolveRequest(db Store, company, id, actor, state, reason string) {
	db.exec(`UPDATE company_requests SET state=$3,resolution=$4,resolved_by=$5,resolved_at=now() WHERE company_id=$1 AND id=$2`, company, id, state, reason, actor)
	db.audit(actor, company, "request.resolved", id, Row{"state": state, "reason": reason})
}
