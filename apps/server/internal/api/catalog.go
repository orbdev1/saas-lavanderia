package api

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
)

func (s *Server) catalogRoutes(add func(string, string, endpoint)) {
	add("GET", "/customers", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r)
		search := r.URL.Query().Get("search")
		require(len([]rune(search)) <= 120, 400, "Búsqueda demasiado larga")
		limit := 2000
		if r.URL.Query().Has("search") {
			limit = 30
		}
		return s.store(r).rows(`SELECT id,name,phone,document,notes FROM customers WHERE company_id=$1 AND(name ILIKE $2 OR phone ILIKE $2) ORDER BY name,id LIMIT $3`, t.CompanyID, "%"+literalSearch(search)+"%", limit)
	})
	for _, verb := range []string{"POST", "PUT"} {
		path := "/customers"
		if verb == "PUT" {
			path += "/{id}"
		}
		add(verb, path, func(w http.ResponseWriter, r *http.Request) any {
			t := s.tenant(r)
			b := body(r, "name", "phone", "document", "notes")
			name, phone, document, notes := text(b, "name", 2, 120), text(b, "phone", 0, 20), text(b, "document", 0, 20), text(b, "notes", 0, 1000)
			require(phonePattern.MatchString(phone), 400, "Celular inválido")
			result := s.companyWrite(r, t, nil, func(db Store) any {
				var row Row
				action := "customer.created"
				if verb == "POST" {
					row = db.one(`INSERT INTO customers(company_id,name,phone,document,notes) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,document,notes`, t.CompanyID, name, phone, document, notes)
				} else {
					action = "customer.updated"
					row = db.one(`UPDATE customers SET name=$3,phone=$4,document=$5,notes=$6 WHERE company_id=$1 AND id=$2 RETURNING id`, t.CompanyID, pathID(r), name, phone, document, notes)
				}
				require(row != nil, 404, "Cliente no encontrado")
				db.audit(str(t.Actor, "id"), t.CompanyID, action, str(row, "id"), Row{})
				return row
			})
			if verb == "POST" {
				return created{result}
			}
			return result
		})
	}
	add("GET", "/services", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r)
		return s.store(r).rows(`SELECT id,name,unit,price,minimum::float8 AS minimum,active FROM services WHERE company_id=$1 ORDER BY name`, t.CompanyID)
	})
	for _, verb := range []string{"POST", "PUT"} {
		path := "/services"
		if verb == "PUT" {
			path += "/{id}"
		}
		add(verb, path, func(w http.ResponseWriter, r *http.Request) any {
			t := s.tenant(r, "owner", "manager")
			b := body(r, "name", "unit", "price", "minimum", "active")
			name, unit, price := text(b, "name", 2, 120), text(b, "unit", 1, 10), integer(b, "price", 1, 100_000_000)
			require(unit == "kg" || unit == "piece", 400, "Unidad inválida")
			n, ok := b["minimum"].(json.Number)
			require(ok, 400, "Mínimo inválido")
			minimum, err := strconv.ParseFloat(string(n), 64)
			require(err == nil && minimum >= 0 && minimum <= 1000 && (unit != "piece" || minimum == math.Trunc(minimum)), 400, "Mínimo inválido")
			active := true
			if b["active"] != nil {
				active = boolean(b, "active")
			}
			result := s.companyWrite(r, t, []string{"owner", "manager"}, func(db Store) any {
				var row Row
				action := "service.created"
				if verb == "POST" {
					row = db.one(`INSERT INTO services(company_id,name,unit,price,minimum,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, t.CompanyID, name, unit, price, minimum, active)
				} else {
					action = "service.updated"
					row = db.one(`UPDATE services SET name=$3,unit=$4,price=$5,minimum=$6,active=$7 WHERE company_id=$1 AND id=$2 RETURNING id`, t.CompanyID, pathID(r), name, unit, price, minimum, active)
				}
				require(row != nil, 404, "Servicio no encontrado")
				db.audit(str(t.Actor, "id"), t.CompanyID, action, str(row, "id"), b)
				return row
			})
			if verb == "POST" {
				return created{result}
			}
			return result
		})
	}
}
