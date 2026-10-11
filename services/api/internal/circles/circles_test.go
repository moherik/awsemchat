package circles

import (
	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/migrations"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) (*Service, *pgxpool.Pool, auth.Principal) {
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
	schema := "circles_test_" + rand.Text()
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
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	identity, err := auth.NewService(pool, auth.NewDevelopmentSMS(time.Now), auth.Config{Pepper: []byte(strings.Repeat("p", 32))})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("alice"))
	expiry := time.Now().Add(time.Hour)
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('alice',$1,'ABCDEFGH',1)", digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-alice','alice','device-alice',1,$1,now(),$2)", digest[:], expiry); err != nil {
		t.Fatal(err)
	}
	return NewService(pool, identity), pool, auth.Principal{SessionID: "session-alice", AccountID: "alice", DeviceID: "device-alice", Generation: 1, ExpiresAt: expiry}
}
func TestCreateRetriesReturnSameCircleAndCreatorInterval(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.Create(ctx, a, "create-1")
	if err != nil || retry != c {
		t.Fatalf("retry=%+v err=%v", retry, err)
	}
	if c.ID == "" || c.Epoch != 1 || c.MemberCount != 1 || c.Closed {
		t.Fatalf("circle=%+v", c)
	}
	var count int
	var role string
	if err := pool.QueryRow(ctx, "SELECT count(*),min(role) FROM circle_memberships WHERE circle_id=$1 AND account_id='alice' AND left_epoch IS NULL", c.ID).Scan(&count, &role); err != nil || count != 1 || role != "admin" {
		t.Fatalf("creator intervals=%d role=%s err=%v", count, role, err)
	}
}
func TestSoleCreatorLeavesClosesCircleAndRetainsEndedInterval(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Leave(ctx, a, c.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	var epoch int64
	var closed bool
	if err := pool.QueryRow(ctx, "SELECT member_count,epoch,closed_at IS NOT NULL FROM circles WHERE id=$1", c.ID).Scan(&count, &epoch, &closed); err != nil || count != 0 || epoch != 2 || !closed {
		t.Fatalf("closure count=%d epoch=%d closed=%v err=%v", count, epoch, closed, err)
	}
	var left int64
	if err := pool.QueryRow(ctx, "SELECT left_epoch FROM circle_memberships WHERE circle_id=$1", c.ID).Scan(&left); err != nil || left != 2 {
		t.Fatalf("retained interval left=%d err=%v", left, err)
	}
	if err := s.Leave(ctx, a, c.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("closed leave=%v", err)
	}
}

func TestClosureRevokesPendingInvitesAndNeverRecreatesCircleOnRetry(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("bob"))
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin) VALUES('bob',$1,'BCDEFGHJ')", digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO circle_invites(id,circle_id,inviter_id,invitee_id,status,created_epoch,expires_at) VALUES('invite-1',$1,'alice','bob','pending',1,now()+interval '7 days')", c.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Leave(ctx, a, c.ID); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := pool.QueryRow(ctx, "SELECT status FROM circle_invites WHERE id='invite-1'").Scan(&status); err != nil || status != "revoked" {
		t.Fatalf("invite status=%s err=%v", status, err)
	}
	retry, err := s.Create(ctx, a, "create-1")
	if err != nil || retry.ID != c.ID || !retry.Closed || retry.MemberCount != 0 {
		t.Fatalf("closed create retry=%+v err=%v", retry, err)
	}
}
func TestLastAdminCannotLeaveOtherMembersWithoutHandoff(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("bob"))
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin) VALUES('bob',$1,'BCDEFGHJ')", digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO circle_memberships(id,circle_id,account_id,role,joined_epoch) VALUES('bob-interval',$1,'bob','member',2)", c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE circles SET member_count=2,epoch=2 WHERE id=$1", c.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Leave(ctx, a, c.ID); !errors.Is(err, ErrAdminHandoff) {
		t.Fatalf("admin leave=%v", err)
	}
	var count int
	var epoch int64
	if err := pool.QueryRow(ctx, "SELECT member_count,epoch FROM circles WHERE id=$1", c.ID).Scan(&count, &epoch); err != nil || count != 2 || epoch != 2 {
		t.Fatalf("denied leave mutated circle: count=%d epoch=%d err=%v", count, epoch, err)
	}
}
func TestRevokedSessionCannotCreateOrLeaveCircle(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", a.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, a, "create-2"); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked create=%v", err)
	}
	if err := s.Leave(ctx, a, c.ID); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked leave=%v", err)
	}
}

func TestAdminHandoffRequiresExistingMemberAndAllowsCreatorToLeave(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("bob"))
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin) VALUES('bob',$1,'BCDEFGHJ')", digest[:]); err != nil {
		t.Fatal(err)
	}
	if err := s.Handoff(ctx, a, c.ID, "bob"); !errors.Is(err, ErrDenied) {
		t.Fatalf("nonmember successor=%v", err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO circle_memberships(id,circle_id,account_id,role,joined_epoch) VALUES('bob-interval',$1,'bob','member',2)", c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE circles SET member_count=2,epoch=2 WHERE id=$1", c.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Handoff(ctx, a, c.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	var role string
	if err := pool.QueryRow(ctx, "SELECT role FROM circle_memberships WHERE id='bob-interval'").Scan(&role); err != nil || role != "admin" {
		t.Fatalf("successor role=%s err=%v", role, err)
	}
	if err := s.Handoff(ctx, a, c.ID, "bob"); !errors.Is(err, ErrDenied) {
		t.Fatalf("former admin handoff=%v", err)
	}
	if err := s.Leave(ctx, a, c.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	var closed bool
	if err := pool.QueryRow(ctx, "SELECT member_count,closed_at IS NOT NULL FROM circles WHERE id=$1", c.ID).Scan(&count, &closed); err != nil || count != 1 || closed {
		t.Fatalf("successor Circle count=%d closed=%v err=%v", count, closed, err)
	}
}
