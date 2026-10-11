package migrations

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func database(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("AWSEM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("real PostgreSQL fixture required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "migration_test_" + rand.Text()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestMigrationCreatesIdentitySchemaOnceAndDetectsDrift(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	if err := Ready(ctx, pool); !errors.Is(err, ErrSchema) {
		t.Fatalf("empty schema readiness=%v", err)
	}
	if err := Apply(ctx, pool); err != nil {
		t.Fatalf("apply identity migration: %v", err)
	}
	if err := Apply(ctx, pool); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	if err := Ready(ctx, pool); err != nil {
		t.Fatalf("migrated readiness: %v", err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil || count != 2 {
		t.Fatalf("migration count=%d,error=%v", count, err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts (id,phone_digest,pin) VALUES ('account',decode(repeat('42',32),'hex'),'ABCDEFGH')"); err != nil {
		t.Fatalf("identity schema unavailable: %v", err)
	}
	if _, err := pool.Exec(ctx, "UPDATE schema_migrations SET checksum='changed'"); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, pool); !errors.Is(err, ErrSchema) {
		t.Fatalf("changed migration accepted: %v", err)
	}
	if err := Ready(ctx, pool); !errors.Is(err, ErrSchema) {
		t.Fatalf("changed schema ready: %v", err)
	}
}

func TestConcurrentMigrationIsSerialized(t *testing.T) {
	pool := database(t)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := Apply(context.Background(), pool); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if err := Ready(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
}

func TestReadinessRejectsMissingIdentityTable(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	if err := Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "DROP TABLE auth_sessions"); err != nil {
		t.Fatal(err)
	}
	if err := Ready(ctx, pool); !errors.Is(err, ErrSchema) {
		t.Fatalf("incomplete identity schema ready: %v", err)
	}
}

func TestSocialMigrationCreatesFriendshipAndBlockingTables(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	if err := Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"friend_links", "friend_blocks"} {
		var exists bool
		if err := pool.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", table).Scan(&exists); err != nil || !exists {
			t.Errorf("required social table %s absent: %v", table, err)
		}
	}
}
