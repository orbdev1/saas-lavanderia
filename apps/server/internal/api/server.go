package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/mail"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	Origin           string
	Production       bool
	Key              []byte
	TrustedProxyCIDR string
}
type Server struct {
	Pool      *pgxpool.Pool
	Config    Config
	hashSlots chan struct{}
}
type endpoint func(http.ResponseWriter, *http.Request) any

func New(pool *pgxpool.Pool, config Config) *Server {
	return &Server{pool, config, make(chan struct{}, 2)}
}
func token() string {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func hash(s string) string                    { b := sha256.Sum256([]byte(s)); return hex.EncodeToString(b[:]) }
func fingerprint(value any) string            { return hash(string(must(json.Marshal(value)))) }
func (s *Server) store(r *http.Request) Store { return Store{r.Context(), s.Pool} }
func body(r *http.Request, fields ...string) Row {
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	var b Row
	require(decoder.Decode(&b) == nil && b != nil, 400, "JSON inválido")
	var extra any
	require(decoder.Decode(&extra) == io.EOF, 400, "JSON inválido")
	for key := range b {
		require(slices.Contains(fields, key), 400, "Campo no permitido: "+key)
	}
	return b
}
func text(b Row, key string, min, max int) string {
	value, ok := b[key].(string)
	if b[key] == nil && min == 0 {
		return ""
	}
	value = strings.TrimSpace(value)
	require(ok && len([]rune(value)) >= min && len([]rune(value)) <= max, 400, "Revisa el campo "+key)
	return value
}
func integer(b Row, key string, min, max int64) int64 {
	n, ok := b[key].(json.Number)
	require(ok, 400, "Revisa el importe o cantidad: "+key)
	value, err := strconv.ParseFloat(string(n), 64)
	require(err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) && value == math.Trunc(value) && value >= float64(min) && value <= float64(max), 400, "Valor fuera de rango: "+key)
	return int64(value)
}
func boolean(b Row, key string) bool {
	if b[key] == nil {
		return false
	}
	v, ok := b[key].(bool)
	require(ok, 400, "Valor inválido: "+key)
	return v
}
func uid(value string) string {
	_, err := uuid.Parse(value)
	require(err == nil && len(value) == 36, 400, "Identificador inválido")
	return value
}
func pathID(r *http.Request) string { return uid(chi.URLParam(r, "id")) }
func email(b Row) string {
	v := strings.ToLower(text(b, "email", 3, 254))
	p, err := mail.ParseAddress(v)
	require(err == nil && p.Address == v, 400, "Correo inválido")
	return v
}
func timestamp(b Row, key string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, text(b, key, 1, 60))
	require(err == nil, 400, "Fecha inválida: "+key)
	return t
}
func quantity(v any, precision int) int64 {
	n, ok := v.(json.Number)
	require(ok, 400, "Cantidad inválida")
	f, err := strconv.ParseFloat(string(n), 64)
	scaled := f * math.Pow10(precision)
	require(err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) && f > 0 && f <= 10000 && math.Abs(scaled-math.Round(scaled)) < 0.00001, 400, "Cantidad inválida; máximo dos decimales")
	return int64(math.Round(f * 1000))
}
func ip(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
func (s *Server) clientIP(r *http.Request) string {
	address := ip(r)
	prefix, err := netip.ParsePrefix(s.Config.TrustedProxyCIDR)
	if err != nil {
		return address
	}
	remote, err := netip.ParseAddr(address)
	if err != nil || !prefix.Contains(remote) {
		return address
	}
	chain := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(chain) - 1; i >= 0; i-- {
		candidate, err := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if err != nil {
			return address
		}
		address = candidate.String()
		if !prefix.Contains(candidate) {
			return address
		}
	}
	return address
}
func (s *Server) wrap(fn endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		defer func() {
			if e := recover(); e != nil {
				f := publicError(e)
				if f.Status == 500 {
					log.Printf("request failed: %T", e)
				}
				w.WriteHeader(f.Status)
				json.NewEncoder(w).Encode(Row{"message": f.Message, "code": f.Code})
			}
		}()
		require(r.Method == "GET" || r.Method == "HEAD" || r.Header.Get("Origin") == s.Config.Origin, 403, "Origen no permitido", "ORIGIN_REJECTED")
		r.Body = http.MaxBytesReader(w, r.Body, 128*1024)
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		result := fn(w, r)
		if result != nil {
			if reply, ok := result.(created); ok {
				w.WriteHeader(201)
				result = reply.Value
			}
			json.NewEncoder(w).Encode(result)
		}
	}
}

type created struct{ Value any }

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	add := func(method, path string, fn endpoint) { r.Method(method, "/api"+path, s.wrap(fn)) }
	add("GET", "/health", func(w http.ResponseWriter, r *http.Request) any {
		s.store(r).one("SELECT 1")
		return Row{"status": "ok"}
	})
	s.authRoutes(add)
	s.teamRoutes(add)
	s.operationRoutes(add)
	s.mfaRoutes(add)
	s.reportRoutes(add)
	s.platformRoutes(add)
	s.requestRoutes(add)
	s.recoveryRoutes(add)
	return r
}
