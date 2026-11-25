package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type testClient struct {
	t                     *testing.T
	handler               http.Handler
	company, cookie, user string
	db                    Store
}

func integrationClient(t *testing.T) *testClient {
	t.Helper()
	database := os.Getenv("GO_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("GO_TEST_DATABASE_URL no configurada")
	}
	u, err := url.Parse(database)
	if err != nil || !strings.HasSuffix(u.Path, "_test") {
		t.Fatal("Se requiere base _test")
	}
	ctx := context.Background()
	if err := Migrate(ctx, database, "../../../api/migrations"); err != nil {
		t.Fatal(err)
	}
	pool, err := OpenPool(ctx, database, 8)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	db := Store{ctx, pool}
	runtimePool := pool
	if runtimeURL := os.Getenv("GO_TEST_RUNTIME_DATABASE_URL"); runtimeURL != "" {
		parsed, err := url.Parse(runtimeURL)
		if err != nil || !strings.HasSuffix(parsed.Path, "_test") {
			t.Fatal("Runtime de prueba requiere base _test")
		}
		runtimePool, err = OpenPool(ctx, runtimeURL, 8)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(runtimePool.Close)
	}
	server := New(runtimePool, Config{Origin: "http://localhost:5173", Key: bytes.Repeat([]byte{7}, 32)})
	client := &testClient{t: t, handler: server.Handler(), db: db}
	response := client.call("POST", "/auth/register", Row{"name": "Dueño Go", "company": "Lavandería Go", "email": uuid.NewString() + "@example.test", "password": "Prueba-segura-123!"})
	client.check(response, 201)
	client.cookie = response.Result().Cookies()[0].Value
	me := decodeRow(client.call("GET", "/auth/me", nil))
	client.user = str(me, "id")
	client.company = str(me["memberships"].([]any)[0].(map[string]any), "companyId")
	return client
}
func (c *testClient) call(method, path string, value any) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/api"+path, bytes.NewBufferString(jsJSON(value)))
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("X-Company-Id", c.company)
	request.RemoteAddr = c.user + uuid.NewString() + ":1111"
	if c.cookie != "" {
		request.AddCookie(&http.Cookie{Name: "session", Value: c.cookie})
	}
	response := httptest.NewRecorder()
	c.handler.ServeHTTP(response, request)
	return response
}
func (c *testClient) check(response *httptest.ResponseRecorder, status int) {
	c.t.Helper()
	if response.Code != status {
		c.t.Fatalf("expected %d got %d: %s", status, response.Code, response.Body.String())
	}
}
func decodeRow(response *httptest.ResponseRecorder) Row {
	var row Row
	if err := json.Unmarshal(response.Body.Bytes(), &row); err != nil {
		panic(err)
	}
	return row
}
func (c *testClient) request(method, path string, value any, status int) Row {
	c.t.Helper()
	response := c.call(method, path, value)
	c.check(response, status)
	return decodeRow(response)
}
func TestFinancialOperations(t *testing.T) {
	c := integrationClient(t)
	customer := str(c.request("POST", "/customers", Row{"name": "Cliente Go", "phone": "912345678"}, 201), "id")
	service := str(c.request("POST", "/services", Row{"name": "Kilos", "unit": "kg", "price": 600, "minimum": 3}, 201), "id")
	piece := str(c.request("POST", "/services", Row{"name": "Piezas", "unit": "piece", "price": 2500, "minimum": 1}, 201), "id")
	create := func(extra Row) (string, Row) {
		b := Row{"customerId": customer, "dueAt": "2026-12-01T17:00:00.000Z", "items": []Row{{"serviceId": service, "quantity": 2}}, "requestId": uuid.NewString()}
		for k, v := range extra {
			b[k] = v
		}
		id := str(c.request("POST", "/orders", b, 201), "id")
		return id, b
	}
	id, input := create(nil)
	t.Run("legacy fingerprint and retry", func(t *testing.T) {
		legacy := `{"customerId":"` + customer + `","dueAt":"2026-12-01T17:00:00.000Z","notes":"","items":[{"serviceId":"` + service + `","quantity":2}],"requestId":"` + str(input, "requestId") + `"}`
		stored := c.db.one(`SELECT request_hash FROM orders WHERE company_id=$1 AND id=$2`, c.company, id)
		if str(stored, "request_hash") != hash(legacy) {
			t.Fatal("Node fingerprint changed")
		}
		if str(c.request("POST", "/orders", input, 201), "id") != id {
			t.Fatal("duplicate order")
		}
		input["notes"] = "Cambio de datos"
		c.check(c.call("POST", "/orders", input), 409)
		delete(input, "notes")
	})
	t.Run("concurrent payment addition cash and historical minimum", func(t *testing.T) {
		cash := str(c.request("POST", "/cash/open", Row{"opening": 1000}, 200), "id")
		pay := Row{"amount": 1000, "method": "cash", "requestId": uuid.NewString()}
		add := Row{"reason": "Añadido concurrente", "items": []Row{{"serviceId": piece, "quantity": 1}}, "requestId": uuid.NewString(), "expectedTotal": 1800, "expectedStatus": "received"}
		var wg sync.WaitGroup
		responses := make(chan *httptest.ResponseRecorder, 3)
		for _, kind := range []string{"payments", "payments", "services"} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				b := pay
				if kind == "services" {
					b = add
				}
				responses <- c.call("POST", "/orders/"+id+"/"+kind, b)
			}()
		}
		wg.Wait()
		close(responses)
		for response := range responses {
			if response.Code != 200 && response.Code != 201 {
				t.Fatal(response.Body.String())
			}
		}
		detail := c.request("GET", "/orders/"+id, nil, 200)
		if num(detail, "total") != 4300 || num(detail, "paid") != 1000 || len(detail["payments"].([]any)) != 1 {
			t.Fatal(detail)
		}
		c.request("PUT", "/services/"+service, Row{"name": "Kilos nuevo", "unit": "kg", "price": 900, "minimum": 5}, 200)
		add["items"] = []Row{{"serviceId": service, "quantity": 0.5}}
		add["requestId"] = uuid.NewString()
		add["expectedTotal"] = 4300
		c.request("POST", "/orders/"+id+"/services", add, 201)
		if num(c.request("GET", "/orders/"+id, nil, 200), "total") != 4300 {
			t.Fatal("minimum charged twice")
		}
		c.request("POST", "/orders/"+id+"/refunds", Row{"amount": 200, "method": "cash", "reason": "Devolución parcial", "requestId": uuid.NewString()}, 200)
		closed := c.request("POST", "/cash/"+cash+"/close", Row{"counted": 1800}, 200)
		if num(closed, "expected") != 1800 {
			t.Fatal(closed)
		}
		c.check(c.call("POST", "/orders/"+id+"/payments", Row{"amount": 100, "method": "cash", "requestId": uuid.NewString()}), 409)
	})
	t.Run("delivery and reopening ready", func(t *testing.T) {
		c.request("PATCH", "/orders/"+id+"/status", Row{"status": "processing"}, 200)
		c.request("PATCH", "/orders/"+id+"/status", Row{"status": "ready"}, 200)
		c.check(c.call("PATCH", "/orders/"+id+"/status", Row{"status": "delivered"}), 409)
		add := Row{"reason": "Más prendas al retirar", "items": []Row{{"serviceId": piece, "quantity": 1}}, "requestId": uuid.NewString(), "expectedTotal": 4300, "expectedStatus": "ready"}
		c.request("POST", "/orders/"+id+"/services", add, 201)
		detail := c.request("GET", "/orders/"+id, nil, 200)
		if str(detail, "status") != "processing" || num(detail, "total") != 6800 {
			t.Fatal(detail)
		}
		c.request("POST", "/orders/"+id+"/payments", Row{"amount": 6000, "method": "yape", "requestId": uuid.NewString()}, 200)
		c.request("PATCH", "/orders/"+id+"/status", Row{"status": "ready"}, 200)
		c.request("PATCH", "/orders/"+id+"/status", Row{"status": "delivered"}, 200)
		c.request("POST", "/orders/"+id+"/services", add, 201)
		c.check(c.call("POST", "/orders/"+id+"/refunds", Row{"amount": 1, "method": "yape", "reason": "Pedido entregado", "requestId": uuid.NewString()}), 409)
	})
	t.Run("discount snapshots notes and express", func(t *testing.T) {
		newID, _ := create(Row{"discount": 500, "express": true, "garmentCount": 4, "items": []Row{{"serviceId": piece, "quantity": 2, "notes": "Cuidado con botones"}}})
		detail := c.request("GET", "/orders/"+newID, nil, 200)
		if num(detail, "total") != 4500 || num(detail, "subtotal") != 5000 || !flag(detail, "express") {
			t.Fatal(detail)
		}
		c.check(c.call("POST", "/orders", Row{"customerId": customer, "dueAt": "2026-12-01T17:00:00Z", "items": []Row{{"serviceId": piece, "quantity": 0.5}, {"serviceId": piece, "quantity": 0.5}}, "requestId": uuid.NewString()}), 400)
		other := integrationClient(t)
		other.check(other.call("GET", "/orders/"+newID, nil), 404)
		other.check(other.call("POST", "/orders", Row{"customerId": customer, "dueAt": "2026-12-01T17:00:00Z", "items": []Row{{"serviceId": piece, "quantity": 1}}, "requestId": uuid.NewString()}), 404)
	})
	t.Run("staff cannot authorize discounts and foreign lines roll back", func(t *testing.T) {
		staffID := str(c.db.one(`INSERT INTO users(name,email,password) VALUES('Empleado',$1,$2) RETURNING id`, uuid.NewString()+"@example.test", legacyPassword), "id")
		c.db.exec(`INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'staff')`, c.company, staffID)
		value := token()
		insertSession(c.db, httptest.NewRequest("GET", "/", nil), staffID, value)
		staff := &testClient{t: t, handler: c.handler, company: c.company, cookie: value, user: staffID, db: c.db}
		staff.check(staff.call("POST", "/orders", Row{"customerId": customer, "dueAt": "2026-12-01T17:00:00Z", "items": []Row{{"serviceId": piece, "quantity": 1}}, "discount": 1, "requestId": uuid.NewString()}), 403)
		newID, _ := create(nil)
		before := c.request("GET", "/orders/"+newID, nil, 200)
		requestID := uuid.NewString()
		c.check(c.call("POST", "/orders/"+newID+"/services", Row{"reason": "Prueba de rollback", "items": []Row{{"serviceId": piece, "quantity": 1}, {"serviceId": uuid.NewString(), "quantity": 1}}, "requestId": requestID, "expectedTotal": before["total"], "expectedStatus": "received"}), 400)
		after := c.request("GET", "/orders/"+newID, nil, 200)
		if num(after, "total") != num(before, "total") || len(after["items"].([]any)) != 1 {
			t.Fatal("partial addition committed")
		}
		if c.db.one(`SELECT request_id FROM order_additions WHERE company_id=$1 AND request_id=$2`, c.company, requestID) != nil {
			t.Fatal("failed request persisted")
		}
	})
	t.Run("delivery and addition serialize", func(t *testing.T) {
		newID, _ := create(nil)
		before := c.request("GET", "/orders/"+newID, nil, 200)
		c.request("POST", "/orders/"+newID+"/payments", Row{"amount": before["total"], "method": "plin", "requestId": uuid.NewString()}, 200)
		c.request("PATCH", "/orders/"+newID+"/status", Row{"status": "processing"}, 200)
		c.request("PATCH", "/orders/"+newID+"/status", Row{"status": "ready"}, 200)
		var addition, delivery *httptest.ResponseRecorder
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			addition = c.call("POST", "/orders/"+newID+"/services", Row{"reason": "Más trabajo concurrente", "items": []Row{{"serviceId": piece, "quantity": 1}}, "requestId": uuid.NewString(), "expectedTotal": before["total"], "expectedStatus": "ready"})
		}()
		go func() {
			defer wg.Done()
			delivery = c.call("PATCH", "/orders/"+newID+"/status", Row{"status": "delivered"})
		}()
		wg.Wait()
		after := c.request("GET", "/orders/"+newID, nil, 200)
		if addition.Code == 201 {
			c.check(delivery, 409)
			if str(after, "status") != "processing" {
				t.Fatal(after)
			}
		} else {
			c.check(addition, 409)
			c.check(delivery, 200)
			if str(after, "status") != "delivered" {
				t.Fatal(after)
			}
		}
	})
}
func TestMFA(t *testing.T) {
	c := integrationClient(t)
	c.db.exec(`UPDATE users SET platform_admin=true WHERE id=$1`, c.user)
	setup := c.request("POST", "/auth/mfa/setup", Row{"password": "Prueba-segura-123!"}, 200)
	secret := str(setup, "secret")
	step := time.Now().Unix() / 30
	result := c.request("POST", "/auth/mfa/enable", Row{"code": totp(secret, step)}, 200)
	if len(result["recoveryCodes"].([]any)) != 8 {
		t.Fatal("missing recovery codes")
	}
	stored := str(c.db.one(`SELECT totp_secret FROM users WHERE id=$1`, c.user), "totp_secret")
	if strings.Contains(stored, secret) {
		t.Fatal("MFA secret not encrypted")
	}
	c.db.exec(`UPDATE sessions SET mfa_verified=false WHERE user_id=$1`, c.user)
	c.check(c.call("POST", "/auth/mfa/verify", Row{"code": totp(secret, step)}), 401)
	code := result["recoveryCodes"].([]any)[0]
	c.request("POST", "/auth/mfa/verify", Row{"code": code}, 200)
	c.check(c.call("POST", "/auth/mfa/verify", Row{"code": code}), 401)
}
