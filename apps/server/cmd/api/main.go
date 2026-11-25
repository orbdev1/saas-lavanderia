package main

import (
	"context"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"lavanda/server/internal/api"
)

func main() {
	command := ""
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if file := os.Getenv("ENV_FILE"); file != "" {
		if err := godotenv.Load(file); err != nil {
			log.Fatal(err)
		}
	} else if (command == "dev" || command == "migrate" || command == "admin") && os.Getenv("DATABASE_URL") == "" {
		if err := godotenv.Load(".env"); err != nil {
			log.Fatal("Configura apps/server/.env o ENV_FILE")
		}
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("Configura DATABASE_URL")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if command == "migrate" {
		migrationURL := os.Getenv("MIGRATION_DATABASE_URL")
		if migrationURL == "" {
			log.Fatal("Configura MIGRATION_DATABASE_URL (credencial separada)")
		}
		if err := api.Migrate(ctx, migrationURL, "../api/migrations"); err != nil {
			log.Fatal(err)
		}
		return
	}
	if command == "test-serve" {
		parsed, err := urlpkg(url)
		if err != nil || !strings.HasSuffix(parsed.Path, "_test") {
			log.Fatal("test-serve requiere base _test")
		}
		if err := api.Migrate(ctx, url, "../api/migrations"); err != nil {
			log.Fatal(err)
		}
	}
	if command != "" && command != "dev" && command != "test-serve" && command != "admin" {
		log.Fatal("Comando desconocido")
	}
	origin := os.Getenv("APP_ORIGIN")
	if origin == "" {
		log.Fatal("Configura APP_ORIGIN")
	}
	pool, err := api.OpenPool(ctx, url, 8)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if command == "admin" {
		if len(os.Args) != 3 {
			log.Fatal("Uso: admin correo")
		}
		migrationURL := os.Getenv("MIGRATION_DATABASE_URL")
		if migrationURL == "" {
			log.Fatal("Configura MIGRATION_DATABASE_URL")
		}
		adminPool, err := api.OpenPool(ctx, migrationURL, 1)
		if err != nil {
			log.Fatal(err)
		}
		defer adminPool.Close()
		tx, err := adminPool.Begin(ctx)
		if err != nil {
			log.Fatal(err)
		}
		defer tx.Rollback(ctx)
		var user string
		if err = tx.QueryRow(ctx, `UPDATE users SET platform_admin=true WHERE email=$1 RETURNING id::text`, strings.ToLower(os.Args[2])).Scan(&user); err != nil {
			log.Fatal("Cuenta no encontrada")
		}
		if _, err = tx.Exec(ctx, `INSERT INTO audit(actor_id,action,entity_id,detail) VALUES($1,'platform.admin.granted_cli',$1,'{}')`, user); err != nil {
			log.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			log.Fatal(err)
		}
		log.Print("Administrador habilitado. Configura MFA desde Mi cuenta.")
		return
	}
	if command == "test-serve" {
		if _, err := pool.Exec(ctx, `TRUNCATE login_limits`); err != nil {
			log.Fatal(err)
		}
	}
	address := os.Getenv("GO_LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:3000"
	}
	key, err := hex.DecodeString(os.Getenv("MFA_KEY"))
	if err != nil || len(key) != 32 {
		log.Fatal("MFA_KEY debe ser una clave hexadecimal de 32 bytes")
	}
	trustedProxy := os.Getenv("TRUSTED_PROXY_CIDR")
	if trustedProxy != "" {
		if _, err := netip.ParsePrefix(trustedProxy); err != nil {
			log.Fatal("TRUSTED_PROXY_CIDR inválido")
		}
	}
	server := &http.Server{Addr: address, Handler: api.New(pool, api.Config{
		Origin: origin, Production: os.Getenv("NODE_ENV") == "production", Key: key, TrustedProxyCIDR: trustedProxy,
	}).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 25 * time.Second,
		WriteTimeout: 25 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("API Go: %s", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
func urlpkg(value string) (*url.URL, error) { return url.Parse(value) }
