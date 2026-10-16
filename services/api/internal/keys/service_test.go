package keys

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func keyDatabase(t *testing.T) (*pgxpool.Pool, *auth.Service, auth.Principal) {
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
	schema := "keys_test_" + rand.Text()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
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
	if err = migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	identity, err := auth.NewService(pool, auth.NewDevelopmentSMS(time.Now), auth.Config{Pepper: []byte(strings.Repeat("p", 32))})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('alice',decode(repeat('42',32),'hex'),'ABCDEFGH',1)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-alice','alice','device-alice',1,decode(repeat('43',32),'hex'),now(),now()+interval '1 hour')`)
	if err != nil {
		t.Fatal(err)
	}
	return pool, identity, auth.Principal{AccountID: "alice", DeviceID: "device-alice", Generation: 1, SessionID: "session-alice"}
}

func TestPublicationPersistsPublicKeysAndAcknowledgesExactExpiredRetry(t *testing.T) {
	pool, identity, actor := keyDatabase(t)
	service := NewService(pool, identity)
	ctx := context.Background()
	r := registration(t, actor, []Bundle{signed(t, nil)})
	if err := service.Publish(ctx, actor, r, time.Unix(1000, 0)); err != nil {
		t.Fatal(err)
	}
	if err := service.Publish(ctx, actor, r, time.Unix(1000+604800, 0)); err != nil {
		t.Fatalf("committed retry: %v", err)
	}
	var publications, prekeys int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM key_publications").Scan(&publications); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM key_prekeys").Scan(&prekeys); err != nil {
		t.Fatal(err)
	}
	if publications != 1 || prekeys != 1 {
		t.Fatalf("rows=%d/%d", publications, prekeys)
	}
	changed := registration(t, actor, []Bundle{signed(t, func(b *Bundle) { b.Prekey = b.Identity })})
	if err := service.Publish(ctx, actor, changed, time.Unix(1000, 0)); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed retry=%v", err)
	}
}

func TestPublicationRejectsUncommittedExpiredKeysAndRevokedSession(t *testing.T) {
	pool, identity, actor := keyDatabase(t)
	service := NewService(pool, identity)
	ctx := context.Background()
	r := registration(t, actor, []Bundle{signed(t, nil)})
	if err := service.Publish(ctx, actor, r, time.Unix(1000+604800, 0)); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired=%v", err)
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now()"); err != nil {
		t.Fatal(err)
	}
	if err := service.Publish(ctx, actor, r, time.Unix(1000, 0)); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked=%v", err)
	}
}
