package circles

import (
	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/migrations"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"sync"
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

func addActor(t *testing.T, pool *pgxpool.Pool, id string, accepted bool) auth.Principal {
	t.Helper()
	ctx := context.Background()
	digest := sha256.Sum256([]byte(id))
	expiry := time.Now().Add(time.Hour)
	pin := make([]byte, 8)
	alphabet := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for i := range pin {
		pin[i] = alphabet[int(digest[i])%len(alphabet)]
	}
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES($1,$2,$3,1)", id, digest[:], string(pin)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES($1,$2,$3,1,$4,now(),$5)", "session-"+id, id, "device-"+id, digest[:], expiry); err != nil {
		t.Fatal(err)
	}
	if accepted {
		low, high := "alice", id
		if low > high {
			low, high = high, low
		}
		if _, err := pool.Exec(ctx, "INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES($1,$2,$3,'alice','accepted')", low, high, rand.Text()); err != nil {
			t.Fatal(err)
		}
	}
	return auth.Principal{SessionID: "session-" + id, AccountID: id, DeviceID: "device-" + id, Generation: 1, ExpiresAt: expiry}
}
func TestInvitationRequiresFriendshipAdminAndRecipientConsent(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	bob := addActor(t, pool, "bob", true)
	carol := addActor(t, pool, "carol", false)
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, a, c.ID, carol.AccountID); !errors.Is(err, ErrDenied) {
		t.Fatalf("nonfriend invite=%v", err)
	}
	invite, err := s.Invite(ctx, a, c.ID, bob.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.Invite(ctx, a, c.ID, bob.AccountID)
	if err != nil || retry.ID != invite.ID {
		t.Fatalf("invite retry=%+v err=%v", retry, err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT member_count FROM circles WHERE id=$1", c.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("invitation joined without consent count=%d err=%v", count, err)
	}
	if _, err := s.Respond(ctx, a, invite.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("sender accepted=%v", err)
	}
	accepted, err := s.Respond(ctx, bob, invite.ID, true)
	if err != nil || accepted.Status != "accepted" || accepted.IntervalID == "" {
		t.Fatalf("accept=%+v err=%v", accepted, err)
	}
	again, err := s.Respond(ctx, bob, invite.ID, true)
	if err != nil || again.IntervalID != accepted.IntervalID {
		t.Fatalf("accept retry=%+v err=%v", again, err)
	}
	if _, err := s.Invite(ctx, bob, c.ID, carol.AccountID); !errors.Is(err, ErrDenied) {
		t.Fatalf("member invited=%v", err)
	}
	if err := s.Leave(ctx, bob, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Respond(ctx, bob, invite.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("old invite resurrected=%v", err)
	}
	fresh, err := s.Invite(ctx, a, c.ID, bob.AccountID)
	if err != nil || fresh.ID == invite.ID {
		t.Fatalf("fresh invite=%+v err=%v", fresh, err)
	}
	rejoin, err := s.Respond(ctx, bob, fresh.ID, true)
	if err != nil || rejoin.IntervalID == accepted.IntervalID {
		t.Fatalf("rejoin=%+v err=%v", rejoin, err)
	}
	var joined, left int64
	if err := pool.QueryRow(ctx, "SELECT fresh.joined_epoch,old.left_epoch FROM circle_memberships fresh,circle_memberships old WHERE fresh.id=$1 AND old.id=$2", rejoin.IntervalID, accepted.IntervalID).Scan(&joined, &left); err != nil || joined <= left {
		t.Fatalf("rejoin epoch=%d prior leave=%d err=%v", joined, left, err)
	}
}

func TestConcurrentAcceptanceNeverExceedsTwentyMembers(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	actors := make([]auth.Principal, 24)
	invites := make([]Invitation, 24)
	for n := range actors {
		actors[n] = addActor(t, pool, fmt.Sprintf("peer-%02d", n), true)
		invites[n], err = s.Invite(ctx, a, c.ID, actors[n].AccountID)
		if err != nil {
			t.Fatal(err)
		}
	}
	results := make(chan error, 24)
	var wg sync.WaitGroup
	for n := range actors {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Respond(ctx, actors[n], invites[n].ID, true); results <- err }()
	}
	wg.Wait()
	close(results)
	accepted, full := 0, 0
	for err := range results {
		if err == nil {
			accepted++
		} else if errors.Is(err, ErrFull) {
			full++
		} else {
			t.Errorf("unexpected join failure: %v", err)
		}
	}
	if accepted != 19 || full != 5 {
		t.Fatalf("accepted=%d full=%d", accepted, full)
	}
	var count, active int
	if err := pool.QueryRow(ctx, "SELECT member_count,(SELECT count(*) FROM circle_memberships WHERE circle_id=$1 AND left_epoch IS NULL) FROM circles WHERE id=$1", c.ID).Scan(&count, &active); err != nil || count != 20 || active != 20 {
		t.Fatalf("count=%d active=%d err=%v", count, active, err)
	}
}
func TestBlockedAndExpiredInvitesCannotJoin(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	bob := addActor(t, pool, "bob", true)
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := s.Invite(ctx, a, c.ID, bob.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO friend_blocks(actor_id,target_id) VALUES('bob','alice')"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Respond(ctx, bob, invite.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("blocked join=%v", err)
	}
	if _, err := pool.Exec(ctx, "DELETE FROM friend_blocks"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE circle_invites SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1", invite.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Respond(ctx, bob, invite.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("expired join=%v", err)
	}
	fresh, err := s.Invite(ctx, a, c.ID, bob.AccountID)
	if err != nil || fresh.ID == invite.ID {
		t.Fatalf("expired replacement=%+v err=%v", fresh, err)
	}
	declined, err := s.Respond(ctx, bob, fresh.ID, false)
	if err != nil || declined.Status != "declined" {
		t.Fatalf("decline=%+v err=%v", declined, err)
	}
	if _, err := s.Respond(ctx, bob, fresh.ID, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("declined join=%v", err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT member_count FROM circles WHERE id=$1", c.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("denied join count=%d err=%v", count, err)
	}
}
