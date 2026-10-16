package messages

import (
	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
	"context"
	"errors"
	"testing"
)

func TestDeliveryAcknowledgementIsRecipientOwnedAndIdempotent(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actors[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, actors[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	binding, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, actors[0], contextEnvelope(t, binding, "receipt-one"))
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Acknowledge(ctx, actors[2], event.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("Acknowledge(outsider)=%v, want denied", err)
	}
	for i := 0; i < 2; i++ {
		if err = service.Acknowledge(ctx, actors[1], event.ID); err != nil {
			t.Fatalf("Acknowledge(recipient retry %d)=%v, want nil", i, err)
		}
	}
	status, err := service.Status(ctx, actors[0], event.ID)
	if err != nil || status.Status != "delivered" {
		t.Fatalf("Status(sender)=%+v,%v, want delivered", status, err)
	}
	if _, err = service.Status(ctx, actors[2], event.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("Status(outsider)=%v, want denied", err)
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM message_deliveries WHERE delivered_at IS NOT NULL").Scan(&count); err != nil || count != 1 {
		t.Fatalf("acknowledgements=%d,%v, want 1", count, err)
	}
}

func TestCircleDeliveryKeepsOriginalRecipientsAfterRemoval(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	accept(t, social, a[0], a[1], "BCDEFGHJ")
	accept(t, social, a[0], a[2], "CDEFGHJK")
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, a[0], "receipt-circle")
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range a[1:] {
		invite, err := group.Invite(ctx, a[0], circle.ID, member.AccountID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = group.Respond(ctx, member, invite.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(pool, identity)
	binding, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], contextEnvelope(t, binding, "circle-receipt"))
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Acknowledge(ctx, a[1], event.ID); err != nil {
		t.Fatal(err)
	}
	if err = group.Remove(ctx, a[0], circle.ID, a[2].AccountID); err != nil {
		t.Fatal(err)
	}
	status, err := service.Status(ctx, a[0], event.ID)
	if err != nil || status.Status != "sent" {
		t.Fatalf("Status(after removal)=%+v,%v, want sent", status, err)
	}
	var original int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM message_deliveries WHERE event_id=$1", event.ID).Scan(&original); err != nil || original != 2 {
		t.Fatalf("original recipients=%d,%v, want 2", original, err)
	}
	// The member can recover an acknowledgement for plaintext saved before removal, without fetching it again.
	if err = service.Acknowledge(ctx, a[2], event.ID); err != nil {
		t.Fatal(err)
	}
	status, err = service.Status(ctx, a[0], event.ID)
	if err != nil || status.Status != "delivered" {
		t.Fatalf("Status(all original acknowledged)=%+v,%v, want delivered", status, err)
	}
}

func TestReplacementGenerationCannotAcknowledgePreviousPhoneDelivery(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	binding, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], contextEnvelope(t, binding, "old-phone"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "UPDATE auth_accounts SET generation=2 WHERE id='bob'"); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "UPDATE auth_sessions SET generation=2 WHERE account_id='bob'"); err != nil {
		t.Fatal(err)
	}
	replacement := a[1]
	replacement.Generation = 2
	if err = service.Acknowledge(ctx, replacement, event.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("Acknowledge(replacement)=%v, want denied", err)
	}
	if err = service.Acknowledge(ctx, a[1], event.ID); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("Acknowledge(old session)=%v, want revoked", err)
	}
	status, err := service.Status(ctx, a[0], event.ID)
	if err != nil || status.Status != "sent" {
		t.Fatalf("Status(old-phone)=%+v,%v, want sent", status, err)
	}
}
