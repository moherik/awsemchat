package friends

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func fixture(t *testing.T) (*Service, *pgxpool.Pool, []auth.Principal) {
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
	schema := "friends_test_" + rand.Text()
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
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	identity, err := auth.NewService(pool, auth.NewDevelopmentSMS(time.Now), auth.Config{Pepper: []byte(strings.Repeat("p", 32))})
	if err != nil {
		t.Fatal(err)
	}
	actors := make([]auth.Principal, 3)
	for i, item := range []struct{ id, pin string }{{"alice", "ABCDEFGH"}, {"bob", "BCDEFGHJ"}, {"carol", "CDEFGHJK"}} {
		digest := sha256.Sum256([]byte(item.id))
		sessionDigest := sha256.Sum256([]byte(tokenFor(item.id)))
		expiry := time.Now().Add(time.Hour)
		if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES($1,$2,$3,1)", item.id, digest[:], item.pin); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES($1,$2,$3,1,$4,now(),$5)", "session-"+item.id, item.id, "device-"+item.id, sessionDigest[:], expiry); err != nil {
			t.Fatal(err)
		}
		actors[i] = auth.Principal{SessionID: "session-" + item.id, AccountID: item.id, DeviceID: "device-" + item.id, Generation: 1, ExpiresAt: expiry}
	}
	return NewService(pool, identity), pool, actors
}
func TestFriendshipRequiresRecipientAcceptanceAndBlocksBothDirections(t *testing.T) {
	s, _, a := fixture(t)
	ctx := context.Background()
	r, err := s.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if r.ID == "" || r.Status != "pending" || r.TargetID != "bob" {
		t.Fatalf("request=%+v", r)
	}
	if allowed, err := s.Allowed(ctx, a[0], "bob"); err != nil || allowed {
		t.Fatalf("pending allowed=%v,error=%v", allowed, err)
	}
	if err := s.Respond(ctx, a[0], r.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("sender accepted own request: %v", err)
	}
	if err := s.Respond(ctx, a[2], r.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("outsider accepted request: %v", err)
	}
	if err := s.Respond(ctx, a[1], r.ID, true); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]int{{0, 1}, {1, 0}} {
		if allowed, err := s.Allowed(ctx, a[pair[0]], a[pair[1]].AccountID); err != nil || !allowed {
			t.Fatalf("accepted denied: %v", err)
		}
	}
	if err := s.Block(ctx, a[1], "alice", true); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]int{{0, 1}, {1, 0}} {
		if allowed, err := s.Allowed(ctx, a[pair[0]], a[pair[1]].AccountID); err != nil || allowed {
			t.Fatalf("blocked allowed=%v,error=%v", allowed, err)
		}
	}
	if _, err := s.Request(ctx, a[0], "BCDEFGHJ"); !errors.Is(err, ErrDenied) {
		t.Fatalf("blocked request: %v", err)
	}
	if err := s.Block(ctx, a[1], "alice", false); err != nil {
		t.Fatal(err)
	}
	if allowed, err := s.Allowed(ctx, a[0], "bob"); err != nil || allowed {
		t.Fatal("unblock resurrected friendship")
	}
	fresh, err := s.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if fresh.ID == r.ID {
		t.Fatal("old request identity reused after block")
	}
	if err := s.Respond(ctx, a[1], r.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("old request replay accepted: %v", err)
	}
}
func TestConcurrentRequestsRemainOnePendingRequestWithoutAutoAcceptance(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			actor, pin := a[0], "BCDEFGHJ"
			if i%2 == 1 {
				actor, pin = a[1], "ABCDEFGH"
			}
			if _, err := s.Request(ctx, actor, pin); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	var count int
	var status string
	if err := pool.QueryRow(ctx, "SELECT count(*),min(status) FROM friend_links").Scan(&count, &status); err != nil || count != 1 || status != "pending" {
		t.Fatalf("links=%d,status=%s,error=%v", count, status, err)
	}
}
func TestFriendshipRejectsInvalidSelfAndRevokedActions(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	if _, err := s.Request(ctx, a[0], "bad pin"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("malformed PIN accepted: %v", err)
	}
	if _, err := s.Request(ctx, a[0], "ABCDEFGH"); !errors.Is(err, ErrDenied) {
		t.Fatalf("self request accepted: %v", err)
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", a[0].SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Request(ctx, a[0], "BCDEFGHJ"); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked actor accepted: %v", err)
	}
}

func TestRepeatedAcceptanceIsIdempotentWithoutChangingItsTimestamp(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	r, err := s.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Respond(ctx, a[1], r.ID, true); err != nil {
		t.Fatal(err)
	}
	var before, after time.Time
	if err := pool.QueryRow(ctx, "SELECT updated_at FROM friend_links WHERE request_id=$1", r.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := s.Respond(ctx, a[1], r.ID, true); err != nil {
		t.Fatalf("acceptance retry failed: %v", err)
	}
	if err := pool.QueryRow(ctx, "SELECT updated_at FROM friend_links WHERE request_id=$1", r.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !before.Equal(after) {
		t.Fatal("acceptance retry changed relationship timestamp")
	}
	if err := s.Respond(ctx, a[1], r.ID, false); !errors.Is(err, ErrDenied) {
		t.Fatalf("stale decline changed accepted friendship: %v", err)
	}
}

func TestAcceptedFriendshipAuthorizationSharesTheMutationTransaction(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	request, err := s.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RequireAccepted(ctx, tx, a[0], "bob"); !errors.Is(err, ErrDenied) {
		t.Fatalf("pending friendship authorized: %v", err)
	}
	tx.Rollback(ctx)
	if err := s.Respond(ctx, a[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := s.RequireAccepted(ctx, tx, a[0], "bob"); err != nil {
		t.Fatalf("accepted transaction denied: %v", err)
	}
	blockedCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	err = s.Block(blockedCtx, a[1], "alice", true)
	cancel()
	if !errors.Is(err, auth.ErrUnavailable) {
		t.Fatalf("block raced past authorization lock: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Block(ctx, a[1], "alice", true); err != nil {
		t.Fatal(err)
	}
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := s.RequireAccepted(ctx, tx, a[0], "bob"); !errors.Is(err, ErrDenied) {
		t.Fatalf("blocked friendship authorized: %v", err)
	}
}

func TestFriendListsArePaginatedPrivateMetadataAndSeparateIncomingRequests(t *testing.T) {
	s, _, a := fixture(t)
	ctx := context.Background()
	bob, err := s.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Request(ctx, a[2], "ABCDEFGH"); err != nil {
		t.Fatal(err)
	}
	incoming, err := s.List(ctx, a[0], "incoming", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(incoming.Items) != 1 || incoming.Items[0].AccountID != "carol" {
		t.Fatalf("incoming=%+v", incoming)
	}
	outgoing, err := s.List(ctx, a[0], "outgoing", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(outgoing.Items) != 1 || outgoing.Items[0].RequestID != bob.ID {
		t.Fatalf("outgoing=%+v", outgoing)
	}
	if err := s.Respond(ctx, a[1], bob.ID, true); err != nil {
		t.Fatal(err)
	}
	carol, err := s.Request(ctx, a[2], "ABCDEFGH")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Respond(ctx, a[0], carol.ID, true); err != nil {
		t.Fatal(err)
	}
	first, err := s.List(ctx, a[0], "accepted", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 1 || first.Items[0].AccountID != "bob" || first.NextCursor != "bob" {
		t.Fatalf("first page=%+v", first)
	}
	second, err := s.List(ctx, a[0], "accepted", first.NextCursor, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 1 || second.Items[0].AccountID != "carol" || second.NextCursor != "" {
		t.Fatalf("second page=%+v", second)
	}
	if err := s.Block(ctx, a[0], "bob", true); err != nil {
		t.Fatal(err)
	}
	blocked, err := s.List(ctx, a[0], "blocked", "", 25)
	if err != nil {
		t.Fatal(err)
	}
	if len(blocked.Items) != 1 || blocked.Items[0].AccountID != "bob" {
		t.Fatalf("blocked=%+v", blocked)
	}
	empty, err := s.List(ctx, a[1], "accepted", "", 25)
	if err != nil {
		t.Fatal(err)
	}
	if empty.Items == nil || len(empty.Items) != 0 {
		t.Fatalf("empty list=%+v", empty)
	}
	for _, input := range []struct {
		kind, cursor string
		limit        int
	}{{"unknown", "", 25}, {"accepted", "bad cursor", 25}, {"accepted", "", 101}, {"accepted", "", 0}} {
		if _, err := s.List(ctx, a[0], input.kind, input.cursor, input.limit); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid pagination accepted: %v", err)
		}
	}
}
