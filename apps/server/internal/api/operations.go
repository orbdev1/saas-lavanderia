package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

const orderColumns = `o.id,o.number,o.customer_id AS "customerId",c.name AS "customerName",c.phone,
	o.status,o.total,o.paid,o.due_at AS "dueAt",o.notes,o.created_at AS "createdAt",
	o.subtotal,o.discount,o.express,o.garment_count AS "garmentCount"`
const orderJoin = ` FROM orders o JOIN customers c ON c.company_id=o.company_id AND c.id=o.customer_id `

var phonePattern = regexp.MustCompile(`^\+?[0-9 ()-]{0,20}$`)
var orderStates = []string{"all", "received", "processing", "ready", "delivered", "cancelled"}

func jsJSON(value any) string {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return strings.NewReplacer(`\u2028`, "\u2028", `\u2029`, "\u2029").Replace(strings.TrimSuffix(out.String(), "\n"))
}

// Explicit field order preserves JSON.stringify fingerprints already stored by Zod/Node.
func orderedJSON(values Row, keys ...string) string {
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, jsJSON(key)+":"+jsJSON(values[key]))
	}
	return "{" + strings.Join(parts, ",") + "}"
}
func literalSearch(value string) string {
	return strings.NewReplacer(`\`, `\\`, "%", "\\%", "_", "\\_").Replace(value)
}
func defaultInt(b Row, key string, value int64) int64 {
	if b[key] == nil {
		return value
	}
	return integer(b, key, 0, 100_000_000)
}
func methodInput(b Row) string {
	v := text(b, "method", 1, 20)
	require(slices.Contains([]string{"cash", "yape", "plin", "card", "transfer"}, v), 400, "Medio de pago inválido")
	return v
}

// All mutations serialize company -> order -> cash, and recheck current authorization.
func (s *Server) companyWrite(r *http.Request, t Tenant, roles []string, fn func(Store) any) any {
	return s.transaction(r.Context(), func(db Store) any {
		companyLock(db, t.CompanyID)
		current := db.one(`SELECT m.role,c.status,`+subscriptionAllowed+` AS subscribed FROM memberships m JOIN companies c ON c.id=m.company_id
			JOIN users u ON u.id=m.user_id JOIN sessions ss ON ss.user_id=u.id
			WHERE m.company_id=$1 AND m.user_id=$2 AND m.active AND ss.token=$3
			AND ss.expires_at>now() AND NOT u.must_change_password`, t.CompanyID, str(t.Actor, "id"), sessionToken(r))
		require(current != nil && str(current, "status") == "active", 403, "Tu acceso a esta empresa cambió", "COMPANY_ACCESS_REVOKED")
		require(flag(current, "subscribed"), 403, "La suscripción está vencida", "COMPANY_SUSPENDED")
		if len(roles) > 0 {
			require(slices.Contains(roles, str(current, "role")), 403, "Tu rol no permite esta acción")
		}
		return fn(db)
	})
}

type requestedLine struct {
	ServiceID string
	Milli     int64
	Notes     string
}

func readLines(b Row) ([]requestedLine, []json.RawMessage) {
	raw, ok := b["items"].([]any)
	require(ok && len(raw) > 0 && len(raw) <= 50, 400, "Selecciona entre 1 y 50 servicios")
	lines := []requestedLine{}
	legacy := []json.RawMessage{}
	for _, value := range raw {
		item, ok := value.(map[string]any)
		require(ok, 400, "Servicio inválido")
		for key := range item {
			require(slices.Contains([]string{"serviceId", "quantity", "notes"}, key), 400, "Campo de servicio no permitido")
		}
		id := uid(text(item, "serviceId", 1, 40))
		milli := quantity(item["quantity"], 2)
		notes := text(item, "notes", 0, 500)
		lines = append(lines, requestedLine{id, milli, notes})
		legacy = append(legacy, json.RawMessage(orderedJSON(Row{"serviceId": id, "quantity": float64(milli) / 1000}, "serviceId", "quantity")))
	}
	return lines, legacy
}

type pricedLine struct {
	Service                       Row
	Actual, Charged, Price, Total int64
	Notes                         string
}

func priceRequested(db Store, company string, lines []requestedLine, previous map[string]Row) []pricedLine {
	grouped := map[string]int64{}
	notes := map[string][]string{}
	for _, line := range lines {
		grouped[line.ServiceID] += line.Milli
		if line.Notes != "" {
			notes[line.ServiceID] = append(notes[line.ServiceID], line.Notes)
		}
	}
	keys := make([]string, 0, len(grouped))
	for id := range grouped {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	result := []pricedLine{}
	for _, id := range keys {
		service := db.one(`SELECT id,name,unit,price,(minimum*1000)::bigint AS minimum,active FROM services WHERE company_id=$1 AND id=$2 FOR SHARE`, company, id)
		require(service != nil && flag(service, "active"), 400, "Servicio no disponible")
		for _, line := range lines {
			if line.ServiceID == id {
				require(str(service, "unit") != "piece" || line.Milli%1000 == 0, 400, "Las piezas deben ser enteras")
			}
		}
		actual, minimum, price := grouped[id], num(service, "minimum"), num(service, "price")
		original := previous[id]
		if original != nil {
			require(str(original, "unit") == str(service, "unit"), 409, "La unidad cambió; usa un servicio distinto")
			actual += num(original, "actualMilli")
			minimum = num(original, "chargedMilli")
			price = num(original, "price")
			service["name"] = original["name"]
			if str(original, "notes") != "" {
				notes[id] = append([]string{str(original, "notes")}, notes[id]...)
			}
		}
		require(actual <= 10_000_000, 400, "La cantidad acumulada supera 10000")
		charged := max(actual, minimum)
		lineNotes := strings.Join(notes[id], "\n")
		require(len([]rune(lineNotes)) <= 2000, 400, "Las notas acumuladas del servicio son demasiado largas")
		result = append(result, pricedLine{service, actual, charged, price, (charged*price + 500) / 1000, lineNotes})
	}
	return result
}
func saveLine(db Store, company, order string, line pricedLine) {
	db.exec(`INSERT INTO order_items(company_id,order_id,service_id,name,unit,actual,charged,price,total,notes)
		VALUES($1,$2,$3,$4,$5,$6::numeric/1000,$7::numeric/1000,$8,$9,$10)
		ON CONFLICT(company_id,order_id,service_id) DO UPDATE SET actual=excluded.actual,charged=excluded.charged,total=excluded.total,notes=excluded.notes`,
		company, order, str(line.Service, "id"), str(line.Service, "name"), str(line.Service, "unit"), line.Actual, line.Charged, line.Price, line.Total, line.Notes)
}
func replay(db Store, table, company, requestID, fingerprint string) Row {
	require(slices.Contains([]string{"orders", "payments", "order_additions"}, table), 500, "Tabla inválida")
	column := "id"
	if table == "order_additions" {
		column = "order_id"
	}
	row := db.one(fmt.Sprintf(`SELECT %s AS id,request_hash FROM %s WHERE company_id=$1 AND request_id=$2`, column, table), company, requestID)
	if row == nil {
		return nil
	}
	require(str(row, "request_hash") == fingerprint, 409, "La solicitud ya se utilizó con otros datos")
	return Row{"id": row["id"]}
}
func lockedOrder(db Store, company, id string) Row {
	row := db.one(`SELECT id,status,total,paid,discount FROM orders WHERE company_id=$1 AND id=$2 FOR UPDATE`, company, id)
	require(row != nil, 404, "Orden no encontrada")
	return row
}
func openOrder(row Row) {
	require(!slices.Contains([]string{"delivered", "cancelled"}, str(row, "status")), 409, "La orden está cerrada")
}

func (s *Server) operationRoutes(add func(string, string, endpoint)) {
	s.catalogRoutes(add)
	add("GET", "/orders", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r)
		q := r.URL.Query()
		search, status := q.Get("search"), q.Get("status")
		if status == "" {
			status = "all"
		}
		require(len([]rune(search)) <= 120 && slices.Contains(orderStates, status), 400, "Filtros inválidos")
		offset := int64(0)
		if q.Get("offset") != "" {
			v, err := strconv.ParseInt(q.Get("offset"), 10, 32)
			require(err == nil && v >= 0, 400, "Página inválida")
			offset = v
		}
		return s.store(r).rows(`SELECT `+orderColumns+orderJoin+`WHERE o.company_id=$1 AND ($2='all' OR o.status=$2)
			AND(c.name ILIKE $3 OR c.phone ILIKE $3 OR o.number::text=$4) ORDER BY o.created_at DESC,o.id DESC LIMIT 100 OFFSET $5`,
			t.CompanyID, status, "%"+literalSearch(search)+"%", search, offset)
	})
	add("GET", "/orders/{id}", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.tenant(r), pathID(r)
		db := s.store(r)
		row := db.one(`SELECT `+orderColumns+orderJoin+`WHERE o.company_id=$1 AND o.id=$2`, t.CompanyID, id)
		require(row != nil, 404, "Orden no encontrada")
		row["items"] = db.rows(`SELECT service_id AS "serviceId",name,unit,actual::text,charged::text,price,total,notes FROM order_items WHERE company_id=$1 AND order_id=$2 ORDER BY name`, t.CompanyID, id)
		row["payments"] = db.rows(`SELECT id,amount,method,reference,reason,created_at AS "createdAt" FROM payments WHERE company_id=$1 AND order_id=$2 ORDER BY created_at DESC`, t.CompanyID, id)
		return row
	})
	add("POST", "/orders", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r)
		b := body(r, "customerId", "dueAt", "notes", "items", "requestId", "discount", "express", "garmentCount")
		customer, requestID := uid(text(b, "customerId", 1, 40)), uid(text(b, "requestId", 1, 40))
		due := timestamp(b, "dueAt")
		notes := text(b, "notes", 0, 2000)
		lines, legacy := readLines(b)
		discount := defaultInt(b, "discount", 0)
		express := boolean(b, "express")
		var garments any
		if b["garmentCount"] != nil {
			garments = integer(b, "garmentCount", 0, 10000)
		}
		fingerprint := hash(orderedJSON(Row{"customerId": customer, "dueAt": str(b, "dueAt"), "notes": notes, "items": legacy, "requestId": requestID}, "customerId", "dueAt", "notes", "items", "requestId"))
		extended := discount != 0 || express || garments != nil
		for _, line := range lines {
			extended = extended || line.Notes != ""
		}
		if extended {
			fingerprint = hash(fingerprint + jsJSON(Row{"discount": discount, "express": express, "garmentCount": garments, "lines": lines}))
		}
		result := s.companyWrite(r, t, nil, func(db Store) any {
			if existing := replay(db, "orders", t.CompanyID, requestID, fingerprint); existing != nil {
				return existing
			}
			if discount > 0 {
				role := str(db.one(`SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2`, t.CompanyID, str(t.Actor, "id")), "role")
				require(role == "owner" || role == "manager", 403, "Solo administración puede aplicar descuentos")
			}
			require(db.one(`SELECT id FROM customers WHERE company_id=$1 AND id=$2`, t.CompanyID, customer) != nil, 404, "Cliente no encontrado")
			priced := priceRequested(db, t.CompanyID, lines, nil)
			subtotal := int64(0)
			for _, line := range priced {
				subtotal += line.Total
			}
			require(subtotal > 0 && subtotal <= 100_000_000 && discount < subtotal, 400, "Total o descuento fuera de rango")
			number := num(db.one(`UPDATE companies SET next_order=next_order+1 WHERE id=$1 RETURNING next_order-1 AS number`, t.CompanyID), "number")
			order := db.one(`INSERT INTO orders(company_id,branch_id,customer_id,number,request_id,request_hash,total,due_at,notes,discount,express,garment_count)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, t.CompanyID, t.BranchID, customer, number, requestID, fingerprint, subtotal-discount, due, notes, discount, express, garments)
			for _, line := range priced {
				saveLine(db, t.CompanyID, str(order, "id"), line)
			}
			db.audit(str(t.Actor, "id"), t.CompanyID, "order.created", str(order, "id"), Row{"total": subtotal - discount, "subtotal": subtotal, "discount": discount, "number": number})
			return order
		})
		return created{result}
	})
	add("POST", "/orders/{id}/services", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.tenant(r), pathID(r)
		b := body(r, "reason", "items", "requestId", "expectedTotal", "expectedStatus")
		reason, requestID := text(b, "reason", 5, 500), uid(text(b, "requestId", 1, 40))
		lines, legacy := readLines(b)
		expected := integer(b, "expectedTotal", 0, 100_000_000)
		status := text(b, "expectedStatus", 1, 20)
		require(slices.Contains(orderStates[1:], status), 400, "Estado inválido")
		fingerprint := hash(orderedJSON(Row{"orderId": id, "reason": reason, "items": legacy, "requestId": requestID, "expectedTotal": expected, "expectedStatus": status}, "orderId", "reason", "items", "requestId", "expectedTotal", "expectedStatus"))
		for _, line := range lines {
			if line.Notes != "" {
				fingerprint = hash(fingerprint + jsJSON(lines))
				break
			}
		}
		result := s.companyWrite(r, t, nil, func(db Store) any {
			if existing := replay(db, "order_additions", t.CompanyID, requestID, fingerprint); existing != nil {
				return existing
			}
			order := lockedOrder(db, t.CompanyID, id)
			openOrder(order)
			require(num(order, "total") == expected && str(order, "status") == status, 409, "El pedido cambió. Actualiza el detalle y revisa los importes.")
			previous := map[string]Row{}
			for _, row := range db.rows(`SELECT service_id AS id,unit,price,total,name,(actual*1000)::bigint AS "actualMilli",(charged*1000)::bigint AS "chargedMilli",notes FROM order_items WHERE company_id=$1 AND order_id=$2`, t.CompanyID, id) {
				previous[str(row, "id")] = row
			}
			total := num(order, "total")
			count := len(previous)
			for _, line := range priceRequested(db, t.CompanyID, lines, previous) {
				original := previous[str(line.Service, "id")]
				if original == nil {
					count++
				}
				total += line.Total - num(original, "total")
				saveLine(db, t.CompanyID, id, line)
			}
			require(count <= 50 && total <= 100_000_000 && total >= num(order, "total"), 400, "Total o cantidad de servicios fuera de rango")
			if status == "ready" {
				status = "processing"
			}
			db.exec(`UPDATE orders SET total=$3,status=$4 WHERE company_id=$1 AND id=$2`, t.CompanyID, id, total, status)
			db.exec(`INSERT INTO order_additions(company_id,request_id,order_id,request_hash) VALUES($1,$2,$3,$4)`, t.CompanyID, requestID, id, fingerprint)
			db.audit(str(t.Actor, "id"), t.CompanyID, "order.services_added", id, Row{"before": order, "total": total, "status": status, "reason": reason, "items": lines, "requestId": requestID})
			return Row{"id": id}
		})
		return created{result}
	})
	add("PATCH", "/orders/{id}/status", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.tenant(r), pathID(r)
		status := text(body(r, "status"), "status", 1, 20)
		require(slices.Contains([]string{"processing", "ready", "delivered"}, status), 400, "Estado inválido")
		return s.companyWrite(r, t, nil, func(db Store) any {
			order := lockedOrder(db, t.CompanyID, id)
			require(map[string]string{"received": "processing", "processing": "ready", "ready": "delivered"}[str(order, "status")] == status, 409, "Transición de estado no permitida")
			require(status != "delivered" || num(order, "paid") == num(order, "total"), 409, "Cobra el saldo antes de entregar")
			db.exec(`UPDATE orders SET status=$3 WHERE company_id=$1 AND id=$2`, t.CompanyID, id, status)
			db.audit(str(t.Actor, "id"), t.CompanyID, "order."+status, id, Row{})
			return Row{"ok": true}
		})
	})
	add("PATCH", "/orders/{id}", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.tenant(r, "owner", "manager"), pathID(r)
		b := body(r, "dueAt", "notes", "reason")
		due := timestamp(b, "dueAt")
		notes, reason := text(b, "notes", 0, 2000), text(b, "reason", 5, 500)
		return s.companyWrite(r, t, []string{"owner", "manager"}, func(db Store) any {
			order := lockedOrder(db, t.CompanyID, id)
			openOrder(order)
			db.exec(`UPDATE orders SET due_at=$3,notes=$4 WHERE company_id=$1 AND id=$2`, t.CompanyID, id, due, notes)
			db.audit(str(t.Actor, "id"), t.CompanyID, "order.corrected", id, Row{"dueAt": due, "notes": notes, "reason": reason})
			return Row{"id": id}
		})
	})
	add("POST", "/orders/{id}/cancel", func(w http.ResponseWriter, r *http.Request) any {
		t, id := s.tenant(r, "owner", "manager"), pathID(r)
		reason := text(body(r, "reason"), "reason", 5, 500)
		return s.companyWrite(r, t, []string{"owner", "manager"}, func(db Store) any { cancelOrder(db, t, id, reason); return Row{"ok": true} })
	})
	s.paymentRoutes(add)
}
func cancelOrder(db Store, t Tenant, id, reason string) {
	order := lockedOrder(db, t.CompanyID, id)
	openOrder(order)
	require(num(order, "paid") == 0, 409, "Devuelve los abonos antes de anular")
	db.exec(`UPDATE orders SET status='cancelled' WHERE company_id=$1 AND id=$2`, t.CompanyID, id)
	db.audit(str(t.Actor, "id"), t.CompanyID, "order.cancelled", id, Row{"reason": reason})
}
