package circles

import (
	"awsemchat/services/api/internal/auth"
	"context"
	"errors"
	"testing"
)

func TestCircleListsPageActiveMembershipAndDenyOutsiderDetails(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	bob := addActor(t, pool, "bob", true)
	empty, err := s.List(ctx, bob, "", 1)
	if err != nil || empty.Items == nil || len(empty.Items) != 0 {
		t.Fatalf("empty=%+v err=%v", empty, err)
	}
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, a, "create-2"); err != nil {
		t.Fatal(err)
	}
	page, err := s.List(ctx, a, "", 1)
	if err != nil || len(page.Items) != 1 || page.NextCursor == "" {
		t.Fatalf("first=%+v err=%v", page, err)
	}
	next, err := s.List(ctx, a, page.NextCursor, 1)
	if err != nil || len(next.Items) != 1 || next.Items[0].ID == page.Items[0].ID || next.NextCursor != "" {
		t.Fatalf("next=%+v err=%v", next, err)
	}
	if _, err := s.Details(ctx, bob, c.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("outsider details=%v", err)
	}
	i, err := s.Invite(ctx, a, c.ID, bob.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Respond(ctx, bob, i.ID, true); err != nil {
		t.Fatal(err)
	}
	d, err := s.Details(ctx, bob, c.ID)
	if err != nil || d.MemberCount != 2 || len(d.Members) != 2 {
		t.Fatalf("details=%+v err=%v", d, err)
	}
	for _, m := range d.Members {
		if m.IntervalID == "" || m.PIN == "" || m.JoinedEpoch < 1 {
			t.Fatalf("member=%+v", m)
		}
	}
	if err := s.Remove(ctx, a, c.ID, bob.AccountID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Details(ctx, bob, c.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("removed details=%v", err)
	}
	empty, err = s.List(ctx, bob, "", 1)
	if err != nil || len(empty.Items) != 0 {
		t.Fatalf("removed list=%+v err=%v", empty, err)
	}
	if _, err := s.List(ctx, a, "invalid cursor", 1); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cursor=%v", err)
	}
	if _, err := s.List(ctx, a, "", 101); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unbounded=%v", err)
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now() WHERE account_id='alice'"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.List(ctx, a, "", 1); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked list=%v", err)
	}
}
func TestInvitationInboxOnlyListsCurrentActionableRecipientInvites(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	bob := addActor(t, pool, "bob", true)
	circles := make([]Circle, 2)
	for n, op := range []string{"create-1", "create-2"} {
		c, err := s.Create(ctx, a, op)
		if err != nil {
			t.Fatal(err)
		}
		circles[n] = c
		if _, err := s.Invite(ctx, a, c.ID, bob.AccountID); err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.Invitations(ctx, bob, "", 1)
	if err != nil || len(page.Items) != 1 || page.NextCursor == "" {
		t.Fatalf("inbox=%+v err=%v", page, err)
	}
	next, err := s.Invitations(ctx, bob, page.NextCursor, 1)
	if err != nil || len(next.Items) != 1 || next.Items[0].ID == page.Items[0].ID || next.NextCursor != "" {
		t.Fatalf("inbox next=%+v err=%v", next, err)
	}
	own, err := s.Invitations(ctx, a, "", 10)
	if err != nil || own.Items == nil || len(own.Items) != 0 {
		t.Fatalf("sender inbox=%+v err=%v", own, err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO friend_blocks(actor_id,target_id) VALUES('bob','alice')"); err != nil {
		t.Fatal(err)
	}
	hidden, err := s.Invitations(ctx, bob, "", 10)
	if err != nil || len(hidden.Items) != 0 {
		t.Fatalf("blocked inbox=%+v err=%v", hidden, err)
	}
	if _, err := pool.Exec(ctx, "DELETE FROM friend_blocks"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Respond(ctx, bob, page.Items[0].ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE circle_invites SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1", next.Items[0].ID); err != nil {
		t.Fatal(err)
	}
	hidden, err = s.Invitations(ctx, bob, "", 10)
	if err != nil || len(hidden.Items) != 0 {
		t.Fatalf("resolved/expired inbox=%+v err=%v", hidden, err)
	}
}
