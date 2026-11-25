package api

import (
	"github.com/google/uuid"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestAssistedRecovery(t *testing.T) {
	admin := integrationClient(t)
	person := integrationClient(t)
	admin.db.exec(`UPDATE users SET platform_admin=true WHERE id=$1`, admin.user)
	admin.db.exec(`UPDATE sessions SET mfa_verified=true WHERE user_id=$1`, admin.user)
	address := str(person.request("GET", "/auth/me", nil, 200), "email")
	result := admin.request("POST", "/platform/users/"+person.user+"/recovery", Row{"reason": "Identidad verificada por contacto manual"}, 200)
	link := must(url.Parse(str(result, "url")))
	value := link.Query().Get("reset")
	person.request("GET", "/auth/me", nil, 200)
	person.request("POST", "/auth/reset", Row{"token": value, "password": "Nueva-clave-recuperada-123!"}, 200)
	person.check(person.call("GET", "/auth/me", nil), 401)
	person.check(person.call("POST", "/auth/reset", Row{"token": value, "password": "Otro-intento-seguro-123!"}), 400)
	person.request("POST", "/auth/login", Row{"email": address, "password": "Nueva-clave-recuperada-123!"}, 200)
}
func TestCancellationAndSeatsRequests(t *testing.T) {
	c := integrationClient(t)
	customer := str(c.request("POST", "/customers", Row{"name": "Cliente solicitudes", "phone": ""}, 201), "id")
	service := str(c.db.one(`SELECT id FROM services WHERE company_id=$1 AND unit='kg' LIMIT 1`, c.company), "id")
	order := str(c.request("POST", "/orders", Row{"customerId": customer, "dueAt": "2026-12-01T12:00:00Z", "items": []Row{{"serviceId": service, "quantity": 2}}, "requestId": uuid.NewString()}, 201), "id")
	staffID := str(c.db.one(`INSERT INTO users(name,email,password) VALUES('Empleado solicitudes',$1,$2) RETURNING id`, uuid.NewString()+"@example.test", legacyPassword), "id")
	c.db.exec(`INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'staff')`, c.company, staffID)
	value := token()
	insertSession(c.db, httptest.NewRequest("GET", "/", nil), staffID, value)
	staff := &testClient{t: t, db: c.db, handler: c.handler, user: staffID, company: c.company, cookie: value}
	staff.check(staff.call("POST", "/orders/"+order+"/cancel", Row{"reason": "No tiene permiso directo"}), 403)
	request := Row{"kind": "cancel", "orderId": order, "reason": "Cliente desea cancelar", "requestId": uuid.NewString()}
	requestID := str(staff.request("POST", "/requests", request, 200), "id")
	if str(staff.request("POST", "/requests", request, 200), "id") != requestID {
		t.Fatal("duplicate request")
	}
	c.request("POST", "/orders/"+order+"/payments", Row{"amount": 100, "method": "yape", "requestId": uuid.NewString()}, 200)
	c.check(c.call("POST", "/team/requests/"+requestID+"/resolve", Row{"approve": true, "reason": "Revisión de propietario"}), 409)
	c.request("POST", "/orders/"+order+"/refunds", Row{"amount": 100, "method": "yape", "reason": "Reintegrar antes de anular", "requestId": uuid.NewString()}, 200)
	c.request("POST", "/team/requests/"+requestID+"/resolve", Row{"approve": true, "reason": "Se verificó la devolución"}, 200)
	if str(c.request("GET", "/orders/"+order, nil, 200), "status") != "cancelled" {
		t.Fatal("not cancelled")
	}
	c.check(c.call("POST", "/team/requests/"+requestID+"/resolve", Row{"approve": true, "reason": "No duplicar la aprobación"}), 409)
	c.db.exec(`INSERT INTO subscriptions(company_id,anchor,next_charge_start,covered_until,user_limit)
		VALUES($1,current_date,current_date,current_date+30,2)`, c.company)
	seats := str(c.request("POST", "/requests", Row{"kind": "seats", "seats": 3, "reason": "Necesito ampliar el equipo", "requestId": uuid.NewString()}, 200), "id")
	c.db.exec(`UPDATE users SET platform_admin=true WHERE id=$1`, c.user)
	c.db.exec(`UPDATE sessions SET mfa_verified=true WHERE user_id=$1`, c.user)
	c.request("POST", "/platform/requests/"+seats+"/resolve", Row{"approve": true, "reason": "Ampliación comercial autorizada"}, 200)
	if num(c.db.one(`SELECT user_limit FROM subscriptions WHERE company_id=$1`, c.company), "user_limit") != 5 {
		t.Fatal("seat limit not changed")
	}
	c.check(c.call("POST", "/platform/requests/"+seats+"/resolve", Row{"approve": true, "reason": "No duplicar ampliación"}), 409)
}
