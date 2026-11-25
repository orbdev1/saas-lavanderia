package api

import (
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestCalendarAnchor(t *testing.T) {
	parse := func(value string) time.Time { return must(time.Parse("2006-01-02", value)) }
	for _, test := range []struct{ anchor, start, cycle, want string }{
		{"2027-01-31", "2027-01-31", "monthly", "2027-02-28"},
		{"2027-01-31", "2027-02-28", "monthly", "2027-03-31"},
		{"2028-01-31", "2028-01-31", "monthly", "2028-02-29"},
		{"2028-02-29", "2028-02-29", "annual", "2029-02-28"},
		{"2028-02-29", "2031-02-28", "annual", "2032-02-29"},
	} {
		if got := nextPeriod(parse(test.anchor), parse(test.start), test.cycle).Format("2006-01-02"); got != test.want {
			t.Errorf("%+v got %s", test, got)
		}
	}
}
func TestBillingAndPortability(t *testing.T) {
	c := integrationClient(t)
	c.check(c.call("GET", "/platform/finance", nil), 403)
	c.db.exec(`UPDATE users SET platform_admin=true WHERE id=$1`, c.user)
	c.check(c.call("GET", "/platform/finance", nil), 403)
	c.db.exec(`UPDATE sessions SET mfa_verified=true WHERE user_id=$1`, c.user)
	plan := str(c.request("POST", "/platform/plans", Row{"name": "Plan configurable", "monthlyPrice": 3900, "annualPrice": 39900, "userLimit": 2, "reason": "Configuración de prueba"}, 201), "id")
	c.request("PUT", "/platform/companies/"+c.company+"/subscription", Row{"planId": plan, "cycle": "monthly", "anchor": "2026-01-31", "reason": "Asignar el plan acordado"}, 200)
	c.check(c.call("GET", "/orders", nil), 403)
	c.request("GET", "/subscription", nil, 200)
	chargeBody := Row{"requestId": uuid.NewString(), "reason": "Cuota del período"}
	charge := str(c.request("POST", "/platform/companies/"+c.company+"/charges", chargeBody, 200), "id")
	if str(c.request("POST", "/platform/companies/"+c.company+"/charges", chargeBody, 200), "id") != charge {
		t.Fatal("duplicate charge")
	}
	stored := c.db.one(`SELECT period_start::text,period_end::text FROM subscription_charges WHERE company_id=$1 AND id=$2`, c.company, charge)
	if str(stored, "period_end") != "2026-02-28" {
		t.Fatal(stored)
	}
	payment := Row{"chargeId": charge, "amount": 3900, "method": "transfer", "reference": "REF-001", "paidAt": "2026-02-01T12:00:00Z", "reason": "Pago recibido manualmente", "requestId": uuid.NewString()}
	paymentID := str(c.request("POST", "/platform/companies/"+c.company+"/payments", payment, 200), "id")
	c.request("POST", "/platform/companies/"+c.company+"/payments", payment, 200)
	if str(c.db.one(`SELECT covered_until::text FROM subscriptions WHERE company_id=$1`, c.company), "covered_until") != "2026-02-28" {
		t.Fatal("coverage not advanced")
	}
	c.request("POST", "/platform/companies/"+c.company+"/reverse-payment", Row{"paymentId": paymentID, "requestId": uuid.NewString(), "reason": "Transferencia fue revertida"}, 200)
	if str(c.db.one(`SELECT covered_until::text FROM subscriptions WHERE company_id=$1`, c.company), "covered_until") != "2026-01-31" {
		t.Fatal("coverage not revoked")
	}
	c.check(c.call("POST", "/platform/companies/"+c.company+"/reverse-payment", Row{"paymentId": paymentID, "requestId": uuid.NewString(), "reason": "Segundo intento duplicado"}), 409)
	requestID := str(c.request("POST", "/requests", Row{"kind": "export", "reason": "Solicito mis datos para migrar", "requestId": uuid.NewString()}, 200), "id")
	c.check(c.call("GET", "/requests/"+requestID+"/export", nil), 403)
	c.request("POST", "/platform/requests/"+requestID+"/resolve", Row{"approve": true, "reason": "Identidad del propietario verificada"}, 200)
	c.request("GET", "/requests/"+requestID+"/export", nil, 200)
	c.request("POST", "/platform/companies/"+c.company+"/extension", Row{"until": "2099-01-01", "reason": "Prórroga de prueba autorizada"}, 200)
	c.check(c.call("GET", "/orders", nil), 200)
	c.request("PATCH", "/platform/companies/"+c.company, Row{"status": "suspended", "reason": "Suspensión administrativa"}, 200)
	c.check(c.call("GET", "/orders", nil), 403)
	// Grace is three local calendar days; extension does not override manual suspension.
	c.db.exec(`UPDATE companies SET status='active' WHERE id=$1`, c.company)
	c.db.exec(`UPDATE subscriptions SET extension_until=NULL,covered_until=(now() AT TIME ZONE 'America/Lima')::date-2 WHERE company_id=$1`, c.company)
	c.check(c.call("GET", "/orders", nil), 200)
	c.db.exec(`UPDATE subscriptions SET covered_until=(now() AT TIME ZONE 'America/Lima')::date-3 WHERE company_id=$1`, c.company)
	c.check(c.call("GET", "/orders", nil), 403)
	other := integrationClient(t)
	other.check(other.call("GET", "/requests/"+requestID+"/export", nil), 403)
	finance := c.request("GET", "/platform/finance", nil, 200)
	if _, ok := finance["totals"]; !ok {
		t.Fatal("finance unavailable")
	}
}
