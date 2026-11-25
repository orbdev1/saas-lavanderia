package api

import (
	"net/http"
	"strings"
)

func sendCSV(w http.ResponseWriter, filename string, headers []string, rows []Row) {
	lines := []string{strings.Join(headers, ",")}
	for _, row := range rows {
		cells := []string{}
		for _, key := range headers {
			cells = append(cells, csvCell(row[key]))
		}
		lines = append(lines, strings.Join(cells, ","))
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Write([]byte("\uFEFF" + strings.Join(lines, "\r\n") + "\r\n"))
}
func (s *Server) reportRoutes(add func(string, string, endpoint)) {
	add("GET", "/reports", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r)
		return s.store(r).one(`SELECT COUNT(*) FILTER(WHERE status<>'cancelled')::int AS orders,
			COALESCE(SUM(total) FILTER(WHERE status<>'cancelled'),0)::bigint AS sales,
			COALESCE(SUM(total-paid) FILTER(WHERE status<>'cancelled'),0)::bigint AS outstanding,
			COALESCE(SUM(paid),0)::bigint AS collected,COUNT(*) FILTER(WHERE status IN('received','processing','ready'))::int AS active,
			COUNT(*) FILTER(WHERE status='ready')::int AS ready FROM orders WHERE company_id=$1`, t.CompanyID)
	})
	add("GET", "/audit", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r, "owner", "manager")
		return s.store(r).rows(`SELECT a.id,a.action,a.entity_id AS "entityId",a.detail,a.created_at AS "createdAt",u.name AS actor
			FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT 200`, t.CompanyID)
	})
	add("GET", "/customers/export", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r, "owner", "manager")
		db := s.store(r)
		rows := db.rows(`SELECT name AS nombre,phone AS celular,document AS documento,notes AS notas FROM customers WHERE company_id=$1 ORDER BY name,id`, t.CompanyID)
		db.audit(str(t.Actor, "id"), t.CompanyID, "customers.exported", "", Row{"count": len(rows)})
		sendCSV(w, "clientes.csv", []string{"nombre", "celular", "documento", "notas"}, rows)
		return nil
	})
	add("GET", "/reports/export", func(w http.ResponseWriter, r *http.Request) any {
		t := s.tenant(r, "owner", "manager")
		db := s.store(r)
		rows := db.rows(`SELECT o.number,c.name AS customer,o.status,o.total,o.paid,o.total-o.paid AS balance,o.created_at,o.due_at`+orderJoin+`WHERE o.company_id=$1 ORDER BY o.number`, t.CompanyID)
		db.audit(str(t.Actor, "id"), t.CompanyID, "report.exported", "", Row{})
		sendCSV(w, "ordenes-centimos.csv", []string{"number", "customer", "status", "total", "paid", "balance", "created_at", "due_at"}, rows)
		return nil
	})
}
