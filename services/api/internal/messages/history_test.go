package messages

import (
	"context"
	"errors"
	"testing"

	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
)

func TestHistoryPaginatesOnlyAuthorizedUnredactedCiphertext(t *testing.T) {
	pool, identity, accounts := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	accept(t, social, accounts[0], accounts[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	conversation, err := service.Context(ctx, accounts[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	eventIDs := make([]string, 3)
	for index, operation := range []string{"history-one", "history-two", "history-three"} {
		event, sendErr := service.Send(ctx, accounts[0], contextEnvelope(t, conversation, operation))
		if sendErr != nil {
			t.Fatal(sendErr)
		}
		eventIDs[index] = event.ID
	}
	if _, err = service.Redact(ctx, accounts[0], RedactionTarget{EventID: eventIDs[1]}); err != nil {
		t.Fatal(err)
	}

	page, err := service.History(ctx, accounts[1], conversation.Conversation, conversation.Audience, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != eventIDs[2] || page.Cursor != eventIDs[2] || !page.More {
		t.Fatalf("History(first page) = %+v, want newest unredacted event and more=true", page)
	}
	older, err := service.History(ctx, accounts[1], conversation.Conversation, conversation.Audience, page.Cursor, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(older.Items) != 1 || older.Items[0].ID != eventIDs[0] || older.More {
		t.Fatalf("History(older page) = %+v, want oldest unredacted event and more=false", older)
	}
	if _, err = service.History(ctx, accounts[2], conversation.Conversation, conversation.Audience, page.Cursor, 2); !errors.Is(err, ErrInvalid) {
		t.Fatalf("History(foreign cursor) error = %v, want ErrInvalid", err)
	}
	var acknowledged int
	if err = pool.QueryRow(ctx, "SELECT count(delivered_at) FROM message_deliveries").Scan(&acknowledged); err != nil || acknowledged != 0 {
		t.Fatalf("History acknowledgements = %d, error = %v, want unchanged zero", acknowledged, err)
	}
	if err = social.Block(ctx, accounts[0], "bob", true); err != nil {
		t.Fatal(err)
	}
	blocked, err := service.History(ctx, accounts[1], conversation.Conversation, conversation.Audience, "", 25)
	if err != nil || len(blocked.Items) != 0 {
		t.Fatalf("History(blocked friendship) = %+v, %v; want no events", blocked, err)
	}
}

func TestCircleHistoryDoesNotReviveAnOldIntervalAfterRejoin(t *testing.T) {
	pool, identity, accounts := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), accounts[0], accounts[1], "BCDEFGHJ")
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, accounts[0], "history-circle")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := group.Invite(ctx, accounts[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = group.Respond(ctx, accounts[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	firstContext, err := service.Context(ctx, accounts[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	oldEvent, err := service.Send(ctx, accounts[0], contextEnvelope(t, firstContext, "old-interval"))
	if err != nil {
		t.Fatal(err)
	}
	if err = group.Leave(ctx, accounts[1], circle.ID); err != nil {
		t.Fatal(err)
	}
	left, err := service.History(ctx, accounts[1], firstContext.Conversation, firstContext.Audience, "", 25)
	if err != nil || len(left.Items) != 0 {
		t.Fatalf("History(left Circle) = %+v, %v; want no events", left, err)
	}
	invite, err = group.Invite(ctx, accounts[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = group.Respond(ctx, accounts[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	current, err := service.Context(ctx, accounts[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	newEvent, err := service.Send(ctx, accounts[0], contextEnvelope(t, current, "new-interval"))
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.History(ctx, accounts[1], current.Conversation, current.Audience, "", 25)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != newEvent.ID || page.Items[0].ID == oldEvent.ID {
		t.Fatalf("History(rejoined Circle) = %+v, %v; want only new interval event %q", page, err, newEvent.ID)
	}
}
