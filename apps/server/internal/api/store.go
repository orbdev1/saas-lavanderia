package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Row map[string]any
type executor interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}
type Store struct {
	ctx context.Context
	db  executor
}
type Fault struct {
	Status        int
	Message, Code string
}

func (f Fault) Error() string { return f.Message }
func require(ok bool, status int, message string, code ...string) {
	if !ok {
		c := ""
		if len(code) > 0 {
			c = code[0]
		}
		panic(Fault{status, message, c})
	}
}

// Query errors unwind to the HTTP boundary; transaction defers always roll back.
func must[T any](value T, err error) T {
	if err != nil {
		panic(err)
	}
	return value
}
func (s Store) exec(query string, args ...any) pgconn.CommandTag {
	return must(s.db.Exec(s.ctx, query, args...))
}
func (s Store) rows(query string, args ...any) []Row {
	rs := must(s.db.Query(s.ctx, query, args...))
	defer rs.Close()
	result := []Row{}
	for rs.Next() {
		values := must(rs.Values())
		row := Row{}
		for i, f := range rs.FieldDescriptions() {
			v := values[i]
			switch x := v.(type) {
			case [16]byte:
				v = uuid.UUID(x).String()
			case time.Time:
				v = x.UTC().Format(time.RFC3339Nano)
			}
			row[f.Name] = v
		}
		// Normalize pgx numeric/json values to the same JSON contract as the web.
		raw := must(json.Marshal(row))
		var normalized Row
		if err := json.Unmarshal(raw, &normalized); err != nil {
			panic(err)
		}
		result = append(result, normalized)
	}
	if err := rs.Err(); err != nil {
		panic(err)
	}
	return result
}
func (s Store) one(query string, args ...any) Row {
	r := s.rows(query, args...)
	if len(r) == 0 {
		return nil
	}
	return r[0]
}
func (s Store) audit(actor, company, action, entity string, detail any) {
	raw := must(json.Marshal(detail))
	s.exec(`INSERT INTO audit(actor_id,company_id,action,entity_id,detail) VALUES($1,NULLIF($2,'')::uuid,$3,NULLIF($4,'')::uuid,$5::jsonb)`, actor, company, action, entity, string(raw))
}
func (s *Server) transaction(ctx context.Context, fn func(Store) any) any {
	tx := must(s.Pool.BeginTx(ctx, pgx.TxOptions{}))
	defer tx.Rollback(context.Background())
	result := fn(Store{ctx, tx})
	if err := tx.Commit(ctx); err != nil {
		panic(err)
	}
	return result
}
func str(row Row, key string) string {
	if row == nil || row[key] == nil {
		return ""
	}
	return fmt.Sprint(row[key])
}
func num(row Row, key string) int64 {
	if row == nil || row[key] == nil {
		return 0
	}
	switch v := row[key].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	case json.Number:
		return must(v.Int64())
	}
	panic(Fault{400, "Número inválido: " + key, ""})
}
func flag(row Row, key string) bool { v, _ := row[key].(bool); return v }
func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func companyLock(db Store, id string) { db.exec(`SELECT id FROM companies WHERE id=$1 FOR UPDATE`, id) }
func lockBuckets(db Store, keys ...string) {
	sort.Strings(keys)
	for _, key := range keys {
		db.exec(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, key)
	}
}

func OpenPool(ctx context.Context, url string, max int32) (*pgxpool.Pool, error) {
	c, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	c.MaxConns = max
	c.MinConns = 0
	c.MaxConnIdleTime = 30 * time.Second
	c.MaxConnLifetime = time.Hour
	c.ConnConfig.ConnectTimeout = 5 * time.Second
	c.ConnConfig.RuntimeParams["statement_timeout"] = "15000"
	c.ConnConfig.RuntimeParams["lock_timeout"] = "5000"
	c.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "60000"
	p, err := pgxpool.NewWithConfig(ctx, c)
	if err != nil {
		return nil, err
	}
	if err = p.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}
func publicError(err any) Fault {
	if f, ok := err.(Fault); ok {
		return f
	}
	if e, ok := err.(error); ok {
		if errors.Is(e, context.Canceled) {
			return Fault{499, "Solicitud cancelada", "REQUEST_CANCELLED"}
		}
		var pg *pgconn.PgError
		if errors.As(e, &pg) {
			switch pg.Code {
			case "23505":
				return Fault{409, "El registro ya existe", "CONFLICT"}
			case "23503", "23514", "22P02":
				return Fault{400, "Datos o relaciones inválidos", "INVALID_INPUT"}
			case "57014", "55P03", "40P01":
				return Fault{503, "La operación tardó demasiado. Reintenta en unos momentos.", "RETRY"}
			}
		}
		if errors.Is(e, context.DeadlineExceeded) {
			return Fault{503, "La operación tardó demasiado.", "RETRY"}
		}
	}
	return Fault{500, "Error interno. Intenta nuevamente.", "INTERNAL"}
}
func csvCell(v any) string {
	value := ""
	if v != nil {
		value = fmt.Sprint(v)
	}
	start := strings.TrimLeft(value, " \t\r\n\uFEFF")
	if strings.HasPrefix(value, "\t") || strings.HasPrefix(value, "\r") || strings.HasPrefix(value, "\n") || (len(start) > 0 && strings.ContainsRune("=+-@", rune(start[0]))) {
		value = "'" + value
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
