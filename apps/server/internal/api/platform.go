package api

import "net/http"

func (s *Server) platformRoutes(add func(string, string, endpoint)) {
	add("GET", "/platform/companies", func(w http.ResponseWriter, r *http.Request) any {
		actor := s.platform(r)
		db := s.store(r)
		db.audit(str(actor, "id"), "", "platform.metrics.viewed", "", Row{})
		return db.rows(`SELECT c.id,c.name,CASE WHEN c.status='active' AND ` + subscriptionAllowed + ` THEN 'active' ELSE 'suspended' END AS status,
			c.subscription_due AS "subscriptionDue",COUNT(o.id)::int AS orders,
			COALESCE(SUM(o.total-o.paid) FILTER(WHERE o.status<>'cancelled'),0)::bigint AS outstanding,
			COALESCE(SUM(o.paid),0)::bigint AS collected FROM companies c LEFT JOIN orders o ON o.company_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`)
	})
	add("GET", "/platform/companies/{id}", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		return s.transaction(r.Context(), func(db Store) any {
			company := db.one(`SELECT id,name,status,subscription_due AS "subscriptionDue" FROM companies WHERE id=$1`, id)
			require(company != nil, 404, "Empresa no encontrada")
			db.audit(str(actor, "id"), id, "platform.company.viewed", id, Row{})
			return Row{"company": company,
				"members": db.rows(`SELECT u.id,u.name,u.email,m.role,m.active FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY u.name`, id),
				"balances": db.rows(`SELECT c.id,c.name,c.phone,COALESCE(SUM(o.total-o.paid) FILTER(WHERE o.status<>'cancelled'),0)::bigint AS outstanding
					FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.company_id=c.company_id WHERE c.company_id=$1 GROUP BY c.id ORDER BY outstanding DESC LIMIT 200`, id),
				"orders": db.rows(`SELECT `+orderColumns+orderJoin+`WHERE o.company_id=$1 ORDER BY o.created_at DESC LIMIT 100`, id),
				"subscription": db.one(`SELECT company_id AS "companyId",plan_id AS "planId",cycle,price,anchor::text,next_charge_start::text AS "nextChargeStart",
					covered_until::text AS "coveredUntil",trial_until::text AS "trialUntil",extension_until::text AS "extensionUntil",
					user_limit AS "userLimit",branch_limit AS "branchLimit",grace_days AS "graceDays" FROM subscriptions WHERE company_id=$1`, id),
				"charges":  db.rows(`SELECT id,period_start::text AS "periodStart",period_end::text AS "periodEnd",total,paid FROM subscription_charges WHERE company_id=$1 ORDER BY period_start DESC`, id),
				"payments": db.rows(`SELECT id,charge_id AS "chargeId",amount,method,reference,paid_at AS "paidAt",reason,reverses_id AS "reversesId" FROM subscription_payments WHERE company_id=$1 ORDER BY created_at DESC`, id)}
		})
	})
	add("PATCH", "/platform/companies/{id}", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		b := body(r, "status", "reason")
		status, reason := text(b, "status", 1, 20), text(b, "reason", 5, 500)
		require(status == "active" || status == "suspended", 400, "Estado inválido")
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, id)
			before := db.one(`SELECT status FROM companies WHERE id=$1`, id)
			require(before != nil, 404, "Empresa no encontrada")
			db.exec(`UPDATE companies SET status=$2 WHERE id=$1`, id, status)
			db.audit(str(actor, "id"), id, "platform.company.status_changed", id, Row{"before": before, "status": status, "reason": reason})
			return Row{"ok": true}
		})
	})
	add("GET", "/platform/finance", func(w http.ResponseWriter, r *http.Request) any {
		actor := s.platform(r)
		db := s.store(r)
		db.audit(str(actor, "id"), "", "platform.finance.viewed", "", Row{})
		return Row{"totals": db.one(`SELECT (SELECT COALESCE(SUM(amount),0)::bigint FROM subscription_payments) AS income,
			(SELECT COALESCE(SUM(amount),0)::bigint FROM platform_expenses) AS expenses,
			(SELECT COALESCE(SUM(total-paid),0)::bigint FROM subscription_charges) AS outstanding`),
			"expenses": db.rows(`SELECT id,amount,description,paid_at AS "paidAt" FROM platform_expenses ORDER BY paid_at DESC LIMIT 200`),
			"payments": db.rows(`SELECT p.id,c.name AS company,p.amount,p.method,p.reference,p.paid_at AS "paidAt" FROM subscription_payments p JOIN companies c ON c.id=p.company_id ORDER BY p.paid_at DESC LIMIT 200`)}
	})
	s.billingRoutes(add)
}
