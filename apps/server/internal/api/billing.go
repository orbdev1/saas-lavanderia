package api

import (
	"net/http"
	"time"
)

const subscriptionAllowed = `NOT EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.company_id=c.id
	AND (now() AT TIME ZONE 'America/Lima')::date>=GREATEST(sub.covered_until+sub.grace_days,
		COALESCE(sub.trial_until+sub.grace_days,sub.covered_until+sub.grace_days),COALESCE(sub.extension_until,sub.covered_until)))`

func dateInput(b Row, key string) time.Time {
	v := text(b, key, 10, 10)
	date, err := time.Parse("2006-01-02", v)
	require(err == nil, 400, "Fecha inválida: "+key)
	return date
}
func nullableDate(b Row, key string) any {
	if b[key] == nil || b[key] == "" {
		return nil
	}
	return dateInput(b, key)
}
func optionalLimit(b Row, key string) any {
	if b[key] == nil {
		return nil
	}
	return integer(b, key, 1, 100000)
}

// Calculate from the original anchor, never from February's clamped date.
func nextPeriod(anchor, start time.Time, cycle string) time.Time {
	months := (start.Year()-anchor.Year())*12 + int(start.Month()) - int(anchor.Month())
	step := 1
	if cycle == "annual" {
		step = 12
	}
	for {
		months += step
		base := time.Date(anchor.Year(), anchor.Month()+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
		last := time.Date(base.Year(), base.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
		next := time.Date(base.Year(), base.Month(), min(anchor.Day(), last), 0, 0, 0, 0, time.UTC)
		if next.After(start) {
			return next
		}
	}
}
func recalculateCoverage(db Store, company string) {
	sub := db.one(`SELECT anchor::text FROM subscriptions WHERE company_id=$1 FOR UPDATE`, company)
	covered := str(sub, "anchor")
	for _, charge := range db.rows(`SELECT period_start::text,period_end::text,total,paid FROM subscription_charges WHERE company_id=$1 ORDER BY period_start`, company) {
		if str(charge, "period_start") != covered || num(charge, "total") != num(charge, "paid") {
			break
		}
		covered = str(charge, "period_end")
	}
	db.exec(`UPDATE subscriptions SET covered_until=$2 WHERE company_id=$1`, company, covered)
	db.exec(`UPDATE companies SET subscription_due=(SELECT COALESCE(SUM(total-paid),0)::int FROM subscription_charges WHERE company_id=$1) WHERE id=$1`, company)
}
func (s *Server) billingRoutes(add func(string, string, endpoint)) {
	add("GET", "/platform/plans", func(w http.ResponseWriter, r *http.Request) any {
		actor := s.platform(r)
		db := s.store(r)
		db.audit(str(actor, "id"), "", "platform.plans.viewed", "", Row{})
		return db.rows(`SELECT id,name,monthly_price AS "monthlyPrice",annual_price AS "annualPrice",user_limit AS "userLimit",branch_limit AS "branchLimit",active FROM plans ORDER BY name`)
	})
	for _, verb := range []string{"POST", "PUT"} {
		path := "/platform/plans"
		if verb == "PUT" {
			path += "/{id}"
		}
		add(verb, path, func(w http.ResponseWriter, r *http.Request) any {
			actor := s.platform(r)
			b := body(r, "name", "monthlyPrice", "annualPrice", "userLimit", "branchLimit", "active", "reason")
			name, reason := text(b, "name", 2, 120), text(b, "reason", 5, 500)
			monthly, annual := integer(b, "monthlyPrice", 1, 100_000_000), integer(b, "annualPrice", 1, 100_000_000)
			users, branches := optionalLimit(b, "userLimit"), optionalLimit(b, "branchLimit")
			active := true
			if b["active"] != nil {
				active = boolean(b, "active")
			}
			result := s.transaction(r.Context(), func(db Store) any {
				var row Row
				if verb == "POST" {
					row = db.one(`INSERT INTO plans(name,monthly_price,annual_price,user_limit,branch_limit,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, name, monthly, annual, users, branches, active)
				} else {
					row = db.one(`UPDATE plans SET name=$2,monthly_price=$3,annual_price=$4,user_limit=$5,branch_limit=$6,active=$7 WHERE id=$1 RETURNING id`, pathID(r), name, monthly, annual, users, branches, active)
				}
				require(row != nil, 404, "Plan no encontrado")
				db.audit(str(actor, "id"), "", "platform.plan.saved", str(row, "id"), Row{"reason": reason, "values": b})
				return row
			})
			if verb == "POST" {
				return created{result}
			}
			return result
		})
	}
	add("PUT", "/platform/companies/{id}/subscription", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		b := body(r, "planId", "cycle", "anchor", "trialUntil", "userLimit", "branchLimit", "reason")
		planID, cycle, reason := uid(text(b, "planId", 1, 40)), text(b, "cycle", 1, 20), text(b, "reason", 5, 500)
		anchor := dateInput(b, "anchor")
		require(cycle == "monthly" || cycle == "annual", 400, "Ciclo inválido")
		trial := nullableDate(b, "trialUntil")
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, id)
			require(db.one(`SELECT id FROM companies WHERE id=$1`, id) != nil, 404, "Empresa no encontrada")
			plan := db.one(`SELECT * FROM plans WHERE id=$1 AND active FOR SHARE`, planID)
			require(plan != nil, 404, "Plan no disponible")
			price := num(plan, "monthly_price")
			if cycle == "annual" {
				price = num(plan, "annual_price")
			}
			existing := db.one(`SELECT anchor::text FROM subscriptions WHERE company_id=$1 FOR UPDATE`, id)
			if existing != nil {
				require(str(existing, "anchor") == anchor.Format("2006-01-02"), 409, "El día ancla de una suscripción existente se conserva")
			}
			users, branches := plan["user_limit"], plan["branch_limit"]
			if _, ok := b["userLimit"]; ok {
				users = optionalLimit(b, "userLimit")
			}
			if _, ok := b["branchLimit"]; ok {
				branches = optionalLimit(b, "branchLimit")
			}
			if users != nil {
				require(num(db.one(`SELECT count(*) AS count FROM memberships WHERE company_id=$1 AND active`, id), "count") <= num(Row{"v": users}, "v"), 409, "El cupo es menor al equipo activo")
			}
			db.exec(`INSERT INTO subscriptions(company_id,plan_id,cycle,price,anchor,next_charge_start,covered_until,trial_until,user_limit,branch_limit)
				VALUES($1,$2,$3,$4,$5,$5,$5,$6,$7,$8) ON CONFLICT(company_id) DO UPDATE
				SET plan_id=$2,cycle=$3,price=$4,trial_until=$6,user_limit=$7,branch_limit=$8`, id, planID, cycle, price, anchor, trial, users, branches)
			db.audit(str(actor, "id"), id, "platform.subscription.configured", id, b)
			return Row{"ok": true, "reason": reason}
		})
	})
	add("POST", "/platform/companies/{id}/extension", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		b := body(r, "until", "reason")
		until, reason := dateInput(b, "until"), text(b, "reason", 5, 500)
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, id)
			before := db.one(`SELECT extension_until FROM subscriptions WHERE company_id=$1 FOR UPDATE`, id)
			require(before != nil, 404, "Configura la suscripción primero")
			db.exec(`UPDATE subscriptions SET extension_until=$2 WHERE company_id=$1`, id, until)
			db.audit(str(actor, "id"), id, "platform.subscription.extended", id, Row{"before": before, "until": until, "reason": reason})
			return Row{"ok": true}
		})
	})
	add("POST", "/platform/companies/{id}/charges", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		b := body(r, "requestId", "reason")
		requestID, reason := uid(text(b, "requestId", 1, 40)), text(b, "reason", 5, 500)
		fp := fingerprint(Row{"reason": reason})
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, id)
			previous := db.one(`SELECT id,request_hash FROM subscription_charges WHERE company_id=$1 AND request_id=$2`, id, requestID)
			if previous != nil {
				require(str(previous, "request_hash") == fp, 409, "Solicitud reutilizada con otros datos")
				return Row{"id": previous["id"]}
			}
			sub := db.one(`SELECT anchor::text,next_charge_start::text,cycle,price FROM subscriptions WHERE company_id=$1 FOR UPDATE`, id)
			require(sub != nil, 404, "Configura la suscripción primero")
			start := must(time.Parse("2006-01-02", str(sub, "next_charge_start")))
			end := nextPeriod(must(time.Parse("2006-01-02", str(sub, "anchor"))), start, str(sub, "cycle"))
			row := db.one(`INSERT INTO subscription_charges(company_id,period_start,period_end,total,request_id,request_hash)
				VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, id, start, end, num(sub, "price"), requestID, fp)
			db.exec(`UPDATE subscriptions SET next_charge_start=$2 WHERE company_id=$1`, id, end)
			recalculateCoverage(db, id)
			db.audit(str(actor, "id"), id, "platform.charge.created", str(row, "id"), Row{"reason": reason, "start": start, "end": end, "amount": sub["price"]})
			return row
		})
	})
	add("POST", "/platform/companies/{id}/payments", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		b := body(r, "chargeId", "amount", "method", "reference", "paidAt", "reason", "requestId")
		chargeID, requestID := uid(text(b, "chargeId", 1, 40)), uid(text(b, "requestId", 1, 40))
		amount, method, reference, reason := integer(b, "amount", 1, 100_000_000), methodInput(b), text(b, "reference", 1, 120), text(b, "reason", 5, 500)
		paidAt := timestamp(b, "paidAt")
		fp := fingerprint(b)
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, id)
			previous := db.one(`SELECT id,request_hash FROM subscription_payments WHERE company_id=$1 AND request_id=$2`, id, requestID)
			if previous != nil {
				require(str(previous, "request_hash") == fp, 409, "Solicitud reutilizada con otros datos")
				return Row{"id": previous["id"]}
			}
			charge := db.one(`SELECT total,paid FROM subscription_charges WHERE company_id=$1 AND id=$2 FOR UPDATE`, id, chargeID)
			require(charge != nil, 404, "Cuota no encontrada")
			require(amount <= num(charge, "total")-num(charge, "paid"), 409, "El pago supera el saldo de la cuota")
			row := db.one(`INSERT INTO subscription_payments(company_id,charge_id,amount,method,reference,paid_at,reason,actor_id,request_id,request_hash)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, id, chargeID, amount, method, reference, paidAt, reason, str(actor, "id"), requestID, fp)
			db.exec(`UPDATE subscription_charges SET paid=paid+$3 WHERE company_id=$1 AND id=$2`, id, chargeID, amount)
			recalculateCoverage(db, id)
			db.audit(str(actor, "id"), id, "platform.payment.created", str(row, "id"), b)
			return row
		})
	})
	add("POST", "/platform/companies/{id}/reverse-payment", func(w http.ResponseWriter, r *http.Request) any {
		actor, id := s.platform(r), pathID(r)
		b := body(r, "paymentId", "requestId", "reason")
		paymentID, requestID, reason := uid(text(b, "paymentId", 1, 40)), uid(text(b, "requestId", 1, 40)), text(b, "reason", 5, 500)
		fp := fingerprint(b)
		return s.transaction(r.Context(), func(db Store) any {
			companyLock(db, id)
			previous := db.one(`SELECT id,request_hash FROM subscription_payments WHERE company_id=$1 AND request_id=$2`, id, requestID)
			if previous != nil {
				require(str(previous, "request_hash") == fp, 409, "Solicitud reutilizada")
				return Row{"id": previous["id"]}
			}
			// The company lock serializes reversals; immutable payment rows need no UPDATE privilege.
			payment := db.one(`SELECT * FROM subscription_payments WHERE company_id=$1 AND id=$2`, id, paymentID)
			require(payment != nil && num(payment, "amount") > 0, 404, "Pago no encontrado")
			require(db.one(`SELECT id FROM subscription_payments WHERE company_id=$1 AND reverses_id=$2`, id, paymentID) == nil, 409, "El pago ya fue revertido")
			row := db.one(`INSERT INTO subscription_payments(company_id,charge_id,amount,method,reference,paid_at,reason,actor_id,request_id,request_hash,reverses_id)
				VALUES($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10) RETURNING id`, id, payment["charge_id"], -num(payment, "amount"), payment["method"], payment["reference"], reason, str(actor, "id"), requestID, fp, paymentID)
			db.exec(`UPDATE subscription_charges SET paid=paid-$3 WHERE company_id=$1 AND id=$2`, id, payment["charge_id"], num(payment, "amount"))
			recalculateCoverage(db, id)
			db.audit(str(actor, "id"), id, "platform.payment.reversed", str(row, "id"), b)
			return row
		})
	})
	add("POST", "/platform/expenses", func(w http.ResponseWriter, r *http.Request) any {
		actor := s.platform(r)
		b := body(r, "amount", "description", "paidAt", "requestId")
		amount, description := integer(b, "amount", 1, 100_000_000), text(b, "description", 5, 500)
		paidAt, requestID := timestamp(b, "paidAt"), uid(text(b, "requestId", 1, 40))
		fp := fingerprint(b)
		return s.transaction(r.Context(), func(db Store) any {
			lockBuckets(db, "expense:"+requestID)
			previous := db.one(`SELECT id,request_hash FROM platform_expenses WHERE request_id=$1`, requestID)
			if previous != nil {
				require(str(previous, "request_hash") == fp, 409, "Solicitud reutilizada")
				return Row{"id": previous["id"]}
			}
			row := db.one(`INSERT INTO platform_expenses(amount,description,paid_at,actor_id,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, amount, description, paidAt, str(actor, "id"), requestID, fp)
			db.audit(str(actor, "id"), "", "platform.expense.created", str(row, "id"), b)
			return row
		})
	})
}
