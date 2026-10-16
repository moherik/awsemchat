package messages

import (
	"context"
	"errors"
	"testing"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
)

func accept(t *testing.T, social *friends.Service, sender, recipient auth.Principal, pin string) {
	t.Helper()
	request, err := social.Request(context.Background(), sender, pin)
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(context.Background(), recipient, request.ID, true); err != nil {
		t.Fatal(err)
	}
}
func TestInboxPaginatesOwnedCiphertextWithoutAcknowledgingDelivery(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, operation := range []string{"one", "two", "three"} {
		event, err := service.Send(ctx, a[0], contextEnvelope(t, current, operation))
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, event.ID)
	}
	page, err := service.Inbox(ctx, a[1], "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != ids[0] || page.Items[0].SenderID != "alice" || page.Items[0].Message.Body != "c3ludGhldGljIG9wYXF1ZSBjaXBoZXJ0ZXh0" || page.Cursor != ids[0] || !page.More {
		t.Fatalf("page=%+v", page)
	}
	second, err := service.Inbox(ctx, a[1], page.Cursor, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 2 || second.Items[0].ID != ids[1] || second.Items[1].ID != ids[2] || second.Cursor != ids[2] || second.More {
		t.Fatalf("second=%+v", second)
	}
	for _, actor := range []auth.Principal{a[0], a[2]} {
		empty, err := service.Inbox(ctx, actor, "", 25)
		if err != nil || len(empty.Items) != 0 {
			t.Fatalf("outsider=%+v %v", empty, err)
		}
	}
	if _, err := service.Inbox(ctx, a[2], ids[0], 25); !errors.Is(err, ErrInvalid) {
		t.Fatalf("foreign cursor=%v", err)
	}
	var acknowledged int
	if err := pool.QueryRow(ctx, "SELECT count(delivered_at) FROM message_deliveries").Scan(&acknowledged); err != nil || acknowledged != 0 {
		t.Fatalf("fetch acknowledged=%d err=%v", acknowledged, err)
	}
	if err := friends.NewService(pool, identity).Block(ctx, a[0], "bob", true); err != nil {
		t.Fatal(err)
	}
	blocked, err := service.Inbox(ctx, a[1], "", 25)
	if err != nil || len(blocked.Items) != 0 {
		t.Fatalf("blocked inbox=%+v %v", blocked, err)
	}
}

func TestCircleInboxDoesNotReviveAnOldIntervalAfterRejoin(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, a[0], "circle-one")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := group.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = group.Respond(ctx, a[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[0], contextEnvelope(t, current, "before-leave")); err != nil {
		t.Fatal(err)
	}
	if err = group.Leave(ctx, a[1], circle.ID); err != nil {
		t.Fatal(err)
	}
	removed, err := service.Inbox(ctx, a[1], "", 25)
	if err != nil || len(removed.Items) != 0 {
		t.Fatalf("removed inbox=%+v %v", removed, err)
	}
	invite, err = group.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = group.Respond(ctx, a[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	current, err = service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := service.Send(ctx, a[0], contextEnvelope(t, current, "after-rejoin"))
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.Inbox(ctx, a[1], "", 25)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != fresh.ID {
		t.Fatalf("rejoin inbox=%+v %v", page, err)
	}
}
