package api

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestRuntimeDatabasePermissions(t *testing.T) {
	database := os.Getenv("GO_TEST_RUNTIME_DATABASE_URL")
	if database == "" {
		t.Skip("GO_TEST_RUNTIME_DATABASE_URL no configurada")
	}
	parsed, err := url.Parse(database)
	if err != nil || !strings.HasSuffix(parsed.Path, "_test") {
		t.Fatal("Se requiere base _test")
	}
	pool, err := OpenPool(context.Background(), database, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, query := range []string{
		`DELETE FROM payments WHERE false`, `UPDATE payments SET amount=amount WHERE false`,
		`DELETE FROM audit WHERE false`, `UPDATE audit SET action=action WHERE false`,
		`UPDATE users SET platform_admin=true WHERE false`, `SELECT * FROM migrations`,
		`DELETE FROM subscription_payments WHERE false`,
	} {
		_, err := pool.Exec(context.Background(), query)
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "42501" {
			t.Fatalf("permission bypass for %s: %v", query, err)
		}
	}
}
