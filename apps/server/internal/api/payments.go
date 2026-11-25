package api

import "net/http"

func (s *Server) paymentRoutes(add func(string, string, endpoint)) {
	for _, refund := range []bool{false, true} {
		path := "/orders/{id}/payments"
		if refund {
			path = "/orders/{id}/refunds"
		}
		add("POST", path, func(w http.ResponseWriter, r *http.Request) any {
			roles := []string{"owner", "manager", "staff"}
			if refund {
				roles = []string{"owner", "manager"}
			}
			t, id := s.tenant(r, roles...), pathID(r)
			fields := []string{"amount", "method", "reference", "requestId"}
			if refund {
				fields = []string{"reason", "amount", "method", "requestId"}
			}
			b := body(r, fields...)
			amount, method, requestID := integer(b, "amount", 1, 100_000_000), methodInput(b), uid(text(b, "requestId", 1, 40))
			reference, reason := "", ""
			if refund {
				reason = text(b, "reason", 5, 500)
			} else {
				reference = text(b, "reference", 0, 120)
			}
			value := Row{"orderId": id, "refund": refund, "amount": amount, "method": method, "requestId": requestID, "reference": reference, "reason": reason}
			keys := []string{"orderId", "refund", "amount", "method", "reference", "requestId"}
			if refund {
				keys = []string{"orderId", "refund", "reason", "amount", "method", "requestId"}
			}
			fingerprint := hash(orderedJSON(value, keys...))
			return s.companyWrite(r, t, roles, func(db Store) any {
				if row := replay(db, "payments", t.CompanyID, requestID, fingerprint); row != nil {
					return row
				}
				order := lockedOrder(db, t.CompanyID, id)
				openOrder(order)
				if refund {
					require(amount <= num(order, "paid"), 409, "Devolución mayor al importe cobrado")
				} else {
					require(amount <= num(order, "total")-num(order, "paid"), 409, "El pago supera el saldo")
				}
				var cashID any
				if method == "cash" {
					cash := db.one(`SELECT id FROM cash_sessions WHERE company_id=$1 AND branch_id=$2 AND closed_at IS NULL FOR UPDATE`, t.CompanyID, t.BranchID)
					require(cash != nil, 409, "Abre la caja antes de registrar efectivo")
					cashID = cash["id"]
				}
				action := "payment.created"
				signed := amount
				if refund {
					signed = -amount
					action = "payment.refunded"
				}
				row := db.one(`INSERT INTO payments(company_id,order_id,cash_id,amount,method,reference,reason,request_id,request_hash,actor_id)
					VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, t.CompanyID, id, cashID, signed, method, reference, nullable(reason), requestID, fingerprint, str(t.Actor, "id"))
				db.exec(`UPDATE orders SET paid=paid+$3 WHERE company_id=$1 AND id=$2`, t.CompanyID, id, signed)
				db.audit(str(t.Actor, "id"), t.CompanyID, action, id, Row{"amount": signed, "method": method, "paymentId": row["id"]})
				return row
			})
		})
	}
	add("GET", "/cash", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r)
		return s.store(r).rows(`SELECT c.id,c.opened_at AS "openedAt",c.closed_at AS "closedAt",c.opening,c.counted,
			COALESCE(c.expected,c.opening+COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.company_id=c.company_id AND p.cash_id=c.id),0))::bigint AS expected
			FROM cash_sessions c WHERE c.company_id=$1 AND c.branch_id=$2 ORDER BY c.opened_at DESC LIMIT 50`, t.CompanyID, t.BranchID)
	})
	add("POST", "/cash/open", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r)
		opening := integer(body(r, "opening"), "opening", 0, 100_000_000)
		return s.companyWrite(r, t, nil, func(db Store) any {
			require(db.one(`SELECT id FROM cash_sessions WHERE company_id=$1 AND branch_id=$2 AND closed_at IS NULL`, t.CompanyID, t.BranchID) == nil, 409, "Ya hay una caja abierta")
			row := db.one(`INSERT INTO cash_sessions(company_id,branch_id,opened_by,opening) VALUES($1,$2,$3,$4) RETURNING id`, t.CompanyID, t.BranchID, str(t.Actor, "id"), opening)
			db.audit(str(t.Actor, "id"), t.CompanyID, "cash.opened", str(row, "id"), Row{"opening": opening})
			return row
		})
	})
	add("POST", "/cash/{id}/close", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.tenant(r, "owner", "manager"), pathID(r)
		counted := integer(body(r, "counted"), "counted", 0, 100_000_000)
		return s.companyWrite(r, t, []string{"owner", "manager"}, func(db Store) any {
			cash := db.one(`SELECT opening FROM cash_sessions WHERE company_id=$1 AND branch_id=$2 AND id=$3 AND closed_at IS NULL FOR UPDATE`, t.CompanyID, t.BranchID, id)
			require(cash != nil, 409, "Caja no disponible")
			expected := num(cash, "opening") + num(db.one(`SELECT COALESCE(SUM(amount),0)::bigint AS total FROM payments WHERE company_id=$1 AND cash_id=$2`, t.CompanyID, id), "total")
			require(expected >= -2147483648 && expected <= 2147483647, 409, "El cierre supera el rango permitido")
			db.exec(`UPDATE cash_sessions SET closed_at=now(),counted=$3,expected=$4 WHERE company_id=$1 AND id=$2`, t.CompanyID, id, counted, expected)
			db.audit(str(t.Actor, "id"), t.CompanyID, "cash.closed", id, Row{"expected": expected, "counted": counted, "difference": counted - expected})
			return Row{"expected": expected, "counted": counted}
		})
	})
}
