package migrations

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrSchema = errors.New("database schema not ready or migration changed")

//go:embed 001_identity.sql
var identitySQL string

//go:embed 002_social.sql
var socialSQL string

//go:embed 003_circles.sql
var circlesSQL string

var scripts = []struct {
	version int
	sql     string
}{{1, identitySQL}, {2, socialSQL}, {3, circlesSQL}}

func checksum(sql string) string {
	sum := sha256.Sum256([]byte(sql))
	return hex.EncodeToString(sum[:])
}

func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(734295,1)"); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	for _, script := range scripts {
		var stored string
		err = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE version=$1", script.version).Scan(&stored)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if _, err = tx.Exec(ctx, script.sql); err != nil {
				return fmt.Errorf("apply migration %d: %w", script.version, err)
			}
			if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)", script.version, checksum(script.sql)); err != nil {
				return fmt.Errorf("record migration: %w", err)
			}
		case err != nil:
			return fmt.Errorf("read migration ledger: %w", err)
		case stored != checksum(script.sql):
			return ErrSchema
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	return nil
}

func Ready(ctx context.Context, pool *pgxpool.Pool) error {
	for _, script := range scripts {
		var stored string
		if err := pool.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE version=$1", script.version).Scan(&stored); err != nil || stored != checksum(script.sql) {
			return ErrSchema
		}
	}
	for _, table := range []string{"auth_accounts", "auth_challenges", "auth_sessions", "friend_links", "friend_blocks", "circles", "circle_memberships", "circle_invites"} {
		var exists bool
		if err := pool.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", table).Scan(&exists); err != nil || !exists {
			return ErrSchema
		}
	}
	return nil
}
