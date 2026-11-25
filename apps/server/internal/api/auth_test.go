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

	"github.com/google/uuid"
)

// Generated with the existing Node argon2 dependency, not the Go implementation.
const legacyPassword = "$argon2id$v=19$m=65536,t=3,p=4$JRLw1ZO62763K2GdVbWSXQ$Ft/7cjxkgmGyejTObALnjwKsZy2UxoFCMIeei7jvr9U"

func TestLegacyPassword(t *testing.T) {
	if !verifyPassword(legacyPassword, "Clave histórica 123!") {
		t.Fatal("Node hash rejected")
	}
	if verifyPassword(legacyPassword, "Clave histórica 123! ") {
		t.Fatal("password was trimmed")
	}
	for _, value := range []string{"", "$argon2id$v=19$m=999999999,t=3,p=4$x$x", "$argon2id$v=19$m=8,t=3,p=0$x$x"} {
		if verifyPassword(value, "x") {
			t.Fatal("malformed hash accepted")
		}
	}
}

func TestAuthIntegration(t *testing.T) {
	database := os.Getenv("GO_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("GO_TEST_DATABASE_URL no configurada")
	}
	parsed, err := url.Parse(database)
	if err != nil || !strings.HasSuffix(parsed.Path, "_test") {
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
	defer pool.Close()
	db := Store{ctx, pool}
	address := uuid.NewString() + "@example.test"
	user := db.one(`INSERT INTO users(name,email,password) VALUES('Prueba Go',$1,$2) RETURNING id`, address, legacyPassword)
	userID := str(user, "id")
	company := str(db.one(`INSERT INTO companies(name) VALUES('Prueba Go') RETURNING id`), "id")
	db.exec(`INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'owner')`, company, userID)
	db.exec(`INSERT INTO branches(company_id,name) VALUES($1,'Principal')`, company)
	handler := New(pool, Config{Origin: "http://localhost:5173"}).Handler()
	call := func(method, path, cookie string, payload any) *httptest.ResponseRecorder {
		data, _ := json.Marshal(payload)
		request := httptest.NewRequest(method, "/api"+path, bytes.NewReader(data))
		request.RemoteAddr = "test-" + address + ":1234"
		request.Header.Set("Origin", "http://localhost:5173")
		request.Header.Set("X-Company-Id", company)
		if cookie != "" {
			request.AddCookie(&http.Cookie{Name: "session", Value: cookie})
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	check := func(response *httptest.ResponseRecorder, status int) {
		t.Helper()
		if response.Code != status {
			t.Fatalf("expected %d got %d: %s", status, response.Code, response.Body.String())
		}
	}
	t.Run("registration atomicity", func(t *testing.T) {
		input := Row{"name": "Nuevo propietario", "company": "Nueva lavandería Go", "email": uuid.NewString() + "@example.test", "password": "Registro seguro 123!"}
		response := call("POST", "/auth/register", "", input)
		check(response, 201)
		cookie := response.Result().Cookies()[0].Value
		response = call("GET", "/auth/me", cookie, nil)
		check(response, 200)
		var me Row
		json.Unmarshal(response.Body.Bytes(), &me)
		memberships := me["memberships"].([]any)
		if len(memberships) != 1 {
			t.Fatal("missing owner membership")
		}
		membership := memberships[0].(map[string]any)
		if membership["role"] != "owner" {
			t.Fatal("wrong registration role")
		}
		registeredCompany := membership["companyId"]
		count := db.one(`SELECT count(*) AS count FROM services WHERE company_id=$1`, registeredCompany)
		if num(count, "count") != 3 {
			t.Fatal("missing initial catalog")
		}
		check(call("POST", "/auth/register", "", input), 409)
		count = db.one(`SELECT count(*) AS count FROM memberships WHERE user_id=$1`, str(me, "id"))
		if num(count, "count") != 1 {
			t.Fatal("duplicate registration was not rolled back")
		}
	})
	t.Run("legacy session and membership revocation", func(t *testing.T) {
		value := token()
		db.exec(`INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, hash(value), userID)
		check(call("GET", "/auth/me", value, nil), 200)
		db.exec(`UPDATE memberships SET active=false WHERE company_id=$1 AND user_id=$2`, company, userID)
		response := call("GET", "/auth/me", value, nil)
		check(response, 200)
		var me Row
		json.Unmarshal(response.Body.Bytes(), &me)
		if len(me["memberships"].([]any)) != 0 {
			t.Fatal("disabled membership exposed")
		}
		check(call("POST", "/auth/logout", value, nil), 200)
		check(call("GET", "/auth/me", value, nil), 401)
		db.exec(`UPDATE memberships SET active=true WHERE company_id=$1 AND user_id=$2`, company, userID)
	})
	t.Run("login revocation and password rotation", func(t *testing.T) {
		response := call("POST", "/auth/login", "", Row{"email": address, "password": "Clave histórica 123!"})
		check(response, 200)
		cookie := response.Result().Cookies()[0]
		if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatal("unsafe cookie")
		}
		second := token()
		insertSession(db, httptest.NewRequest("GET", "/", nil), userID, second)
		check(call("POST", "/auth/password", cookie.Value, Row{"currentPassword": "Clave histórica 123!", "password": "Nueva contraseña 456!"}), 200)
		check(call("GET", "/auth/me", cookie.Value, nil), 401)
		check(call("GET", "/auth/me", second, nil), 401)
		if !verifyPassword(str(db.one(`SELECT password FROM users WHERE id=$1`, userID), "password"), "Nueva contraseña 456!") {
			t.Fatal("rotation not saved")
		}
		row := db.one(`SELECT count(*) AS count FROM audit WHERE actor_id=$1 AND action='password.changed'`, userID)
		if num(row, "count") != 1 {
			t.Fatal("missing atomic audit")
		}
	})
	t.Run("team isolation identity and owner protection", func(t *testing.T) {
		ownerSession := token()
		insertSession(db, httptest.NewRequest("GET", "/", nil), userID, ownerSession)
		staffEmail := uuid.NewString() + "@example.test"
		response := call("POST", "/team", ownerSession, Row{
			"name": "Empleado Go", "email": staffEmail, "password": "Temporal segura 123!", "role": "staff",
		})
		check(response, 201)
		var result Row
		json.Unmarshal(response.Body.Bytes(), &result)
		staffID := str(result, "id")
		staffSession := token()
		insertSession(db, httptest.NewRequest("GET", "/", nil), staffID, staffSession)
		check(call("GET", "/team", staffSession, nil), 403)
		response = call("GET", "/auth/me", staffSession, nil)
		check(response, 200)
		if !strings.Contains(response.Body.String(), `"mustChangePassword":true`) {
			t.Fatal("temporary password flag absent")
		}
		check(call("PATCH", "/team/"+userID, ownerSession, Row{"role": "staff", "active": false, "reason": "Intento contra propietario"}), 403)
		check(call("PATCH", "/team/"+staffID, ownerSession, Row{"role": "manager", "active": false, "reason": "Empleado retirado"}), 200)
		check(call("GET", "/team", staffSession, nil), 403)
		check(call("PATCH", "/team/"+uuid.NewString(), ownerSession, Row{"role": "staff", "active": false, "reason": "Empleado ajeno"}), 404)
		// Attach an existing identity and confirm that supplied credentials never replace it.
		otherEmail := uuid.NewString() + "@example.test"
		otherID := str(db.one(`INSERT INTO users(name,email,password) VALUES('Identidad original',$1,$2) RETURNING id`, otherEmail, legacyPassword), "id")
		check(call("POST", "/team", ownerSession, Row{"name": "Nombre diferente", "email": otherEmail, "password": "No reemplazar 123!", "role": "manager"}), 201)
		identity := db.one(`SELECT name,password FROM users WHERE id=$1`, otherID)
		if str(identity, "name") != "Identidad original" || str(identity, "password") != legacyPassword {
			t.Fatal("existing identity overwritten")
		}
		managerSession := token()
		insertSession(db, httptest.NewRequest("GET", "/", nil), otherID, managerSession)
		check(call("PATCH", "/team/"+userID, managerSession, Row{"role": "manager", "active": false, "reason": "Quitar propietario"}), 403)
		// Configured caps are enforced on reactivation as well as creation.
		db.exec(`INSERT INTO subscriptions(company_id,anchor,next_charge_start,covered_until,user_limit)
			VALUES($1,current_date,current_date,current_date+30,2)`, company)
		check(call("PATCH", "/team/"+staffID, ownerSession, Row{"role": "staff", "active": true, "reason": "Reactivar empleado"}), 409)
		foreignSession := token()
		foreignID := str(db.one(`INSERT INTO users(name,email,password) VALUES('Ajeno',$1,$2) RETURNING id`, uuid.NewString()+"@example.test", legacyPassword), "id")
		insertSession(db, httptest.NewRequest("GET", "/", nil), foreignID, foreignSession)
		foreignSessionID := str(db.one(`SELECT id FROM sessions WHERE token=$1`, hash(foreignSession)), "id")
		check(call("DELETE", "/auth/sessions/"+foreignSessionID, ownerSession, nil), 404)
		check(call("GET", "/team", foreignSession, nil), 403)
	})
	t.Run("persistent concurrent limit", func(t *testing.T) {
		unknown := uuid.NewString() + "@example.test"
		var wg sync.WaitGroup
		codes := make(chan int, 12)
		for range 12 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				codes <- call("POST", "/auth/login", "", Row{"email": unknown, "password": "Contraseña incorrecta"}).Code
			}()
		}
		wg.Wait()
		close(codes)
		blocked := 0
		for code := range codes {
			if code == 429 {
				blocked++
			} else if code != 401 {
				t.Fatalf("unexpected status %d", code)
			}
		}
		if blocked != 2 {
			t.Fatalf("expected two blocked, got %d", blocked)
		}
		// New server instance shares the same persistent lockout.
		handler = New(pool, Config{Origin: "http://localhost:5173"}).Handler()
		check(call("POST", "/auth/login", "", Row{"email": unknown, "password": "Contraseña incorrecta"}), 429)
	})
	t.Run("origin and assistance", func(t *testing.T) {
		request := httptest.NewRequest("POST", "/api/auth/logout", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		check(response, 403)
		response = call("POST", "/auth/forgot", "", Row{"email": address})
		check(response, 200)
		if !strings.Contains(response.Body.String(), "51946561987") {
			t.Fatal("manual recovery contact absent")
		}
	})
}
