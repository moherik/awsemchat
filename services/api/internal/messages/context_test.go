package messages

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
	"awsemchat/services/api/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func messageDatabase(t *testing.T) (*pgxpool.Pool, *auth.Service, []auth.Principal) {
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
	schema := "messages_test_" + rand.Text()
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
	actors := make([]auth.Principal, 3)
	for i, id := range []string{"alice", "bob", "carol"} {
		digest := sha256.Sum256([]byte(id))
		token := sha256.Sum256([]byte("token-" + id))
		key := base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat([]string{"a", "b", "c"}[i], 32)))
		if _, err := pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES($1,$2,$3,1)`, id, digest[:], []string{"ABCDEFGH", "BCDEFGHJ", "CDEFGHJK"}[i]); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES($1,$2,$3,1,$4,now(),now()+interval '1 hour')`, "session-"+id, id, "device-"+id, token[:]); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO key_identities(account_id,generation,device_id,identity,signing_identity) VALUES($1,1,$2,$3,$3)`, id, "device-"+id, key); err != nil {
			t.Fatal(err)
		}
		actors[i] = auth.Principal{AccountID: id, DeviceID: "device-" + id, SessionID: "session-" + id, Generation: 1}
	}
	return pool, identity, actors
}

func TestPrivateContextRequiresConsentAndBindsFriendshipInterval(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	service := NewService(pool, identity)
	if _, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"}); !errors.Is(err, ErrDenied) {
		t.Fatalf("pending=%v", err)
	}
	social := friends.NewService(pool, identity)
	r, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, a[1], r.ID, true); err != nil {
		t.Fatal(err)
	}
	first, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	reverse, err := service.Context(ctx, a[1], ContextInput{TargetID: "alice"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Conversation != reverse.Conversation || first.Audience != "friend:"+r.ID || reverse.Audience != first.Audience || len(first.Recipients) != 1 || first.Recipients[0].AccountID != "bob" || first.Recipients[0].Generation != 1 {
		t.Fatalf("invalid context=%+v", first)
	}
	if err = social.Block(ctx, a[0], "bob", true); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Context(ctx, a[1], ContextInput{TargetID: "alice"}); !errors.Is(err, ErrDenied) {
		t.Fatalf("blocked=%v", err)
	}
}

func TestCircleContextContainsOnlyCurrentIntervalsAndRejectsRemovedMember(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	r, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, a[1], r.ID, true); err != nil {
		t.Fatal(err)
	}
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, a[0], "circle-one")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := group.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	joined, err := group.Respond(ctx, a[1], invite.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	input := ContextInput{CircleID: circle.ID}
	current, err := service.Context(ctx, a[0], input)
	if err != nil {
		t.Fatal(err)
	}
	if current.Conversation != circle.ID || current.Audience != "circle:2" || len(current.Recipients) != 1 || current.Recipients[0].AccountID != "bob" || current.Recipients[0].IntervalID != joined.IntervalID {
		t.Fatalf("invalid circle context=%+v", current)
	}
	if _, err = service.Context(ctx, a[2], input); !errors.Is(err, ErrDenied) {
		t.Fatalf("outsider=%v", err)
	}
	if err = group.Leave(ctx, a[1], circle.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Context(ctx, a[1], input); !errors.Is(err, ErrDenied) {
		t.Fatalf("removed=%v", err)
	}
	current, err = service.Context(ctx, a[0], input)
	if err != nil {
		t.Fatal(err)
	}
	if current.Audience != "circle:3" || len(current.Recipients) != 0 {
		t.Fatalf("departed audience retained=%+v", current)
	}
}
