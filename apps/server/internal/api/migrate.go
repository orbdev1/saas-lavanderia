package api

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

func Migrate(ctx context.Context, url, directory string) error {
	connection, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer connection.Close(ctx)
	if _, err = connection.Exec(ctx, `SELECT pg_advisory_lock(918411)`); err != nil {
		return err
	}
	defer connection.Exec(ctx, `SELECT pg_advisory_unlock(918411)`)
	if _, err = connection.Exec(ctx, `CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		var exists bool
		if err = connection.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM migrations WHERE name=$1)`, entry.Name()).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		data, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			return err
		}
		tx, err := connection.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(data)); err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO migrations(name) VALUES($1)`, entry.Name())
		}
		if err != nil {
			tx.Rollback(ctx)
			return err
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}
