package messages

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
)

func contextEnvelope(t *testing.T, c ConversationContext, operation string) string {
	t.Helper()
	e := Envelope{Version: 1, Operation: operation, Conversation: c.Conversation, Audience: c.Audience, Sender: c.Sender, Recipients: []Recipient{}}
	for _, peer := range c.Recipients {
		e.Recipients = append(e.Recipients, Recipient{Peer: peer.AccountID, Keys: peer.Keys, Message: Ciphertext{Kind: 0, Body: "c3ludGhldGljIG9wYXF1ZSBjaXBoZXJ0ZXh0"}})
	}
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestConcurrentIdenticalSendsCommitOneEvent(t *testing.T) {
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
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	raw := contextEnvelope(t, current, "concurrent-one")
	type outcome struct {
		event Event
		err   error
	}
	results := make(chan outcome, 8)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; e, err := service.Send(ctx, a[0], raw); results <- outcome{e, err} }()
	}
	close(start)
	wg.Wait()
	close(results)
	id := ""
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if id == "" {
			id = result.event.ID
		}
		if id != result.event.ID {
			t.Fatal("retry created another event")
		}
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM message_events").Scan(&count); err != nil || count != 1 {
		t.Fatalf("event count=%d err=%v", count, err)
	}
}
func TestSendCommitsOneCiphertextEventAndDoesNotInventDelivery(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `INSERT INTO notification_devices(account_id,generation,expo_token) VALUES('bob',1,'ExpoPushToken[recipient]')`); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	raw := contextEnvelope(t, current, "message-one")
	first, err := service.Send(ctx, a[0], raw)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Send(ctx, a[0], raw)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || first != second || first.Status != "sent" {
		t.Fatalf("send=%+v retry=%+v", first, second)
	}
	var events, deliveries, acknowledged, notifications int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM message_events").Scan(&events); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*),count(delivered_at) FROM message_deliveries").Scan(&deliveries, &acknowledged); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM notification_outbox").Scan(&notifications); err != nil {
		t.Fatal(err)
	}
	if events != 1 || deliveries != 1 || acknowledged != 0 || notifications != 1 {
		t.Fatalf("events=%d deliveries=%d acknowledgements=%d notifications=%d", events, deliveries, acknowledged, notifications)
	}
	if _, err = service.Send(ctx, a[0], strings.Replace(raw, "c3ludGhldGljIG9wYXF1ZSBjaXBoZXJ0ZXh0", "ZGlmZmVyZW50", 1)); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed retry=%v", err)
	}
	if err = social.Block(ctx, a[0], "bob", true); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[0], contextEnvelope(t, current, "message-two")); !errors.Is(err, ErrDenied) {
		t.Fatalf("stale context sent=%v", err)
	}
}

func TestPingAndPongUsePrivateChatOnly(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	accept(t, social, actors[0], actors[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	private, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := DecodeEnvelope(contextEnvelope(t, private, "private-ping"))
	if err != nil {
		t.Fatal(err)
	}
	envelope.ContentType = "ping"
	raw, _ := json.Marshal(envelope)
	if _, err := service.Send(ctx, actors[0], string(raw)); err != nil {
		t.Fatalf("private PING rejected: %v", err)
	}

	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "ping-only-circle")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := group.Invite(ctx, actors[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = group.Respond(ctx, actors[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	circleContext, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	circleEnvelope, err := DecodeEnvelope(contextEnvelope(t, circleContext, "circle-pong"))
	if err != nil {
		t.Fatal(err)
	}
	circleEnvelope.ContentType = "pong"
	circleRaw, _ := json.Marshal(circleEnvelope)
	if _, err := service.Send(ctx, actors[0], string(circleRaw)); !errors.Is(err, ErrDenied) {
		t.Fatalf("Circle PONG error=%v; want denied", err)
	}
}

func TestSendRejectsOperationCancelledBeforeRelayCommit(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actors[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err := social.Respond(ctx, actors[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	raw := contextEnvelope(t, current, "cancel-before-send")
	if _, err := pool.Exec(ctx, `INSERT INTO message_operation_cancellations(sender_id,sender_generation,operation_id) VALUES($1,$2,$3)`, actors[0].AccountID, actors[0].Generation, "cancel-before-send"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, actors[0], raw); !errors.Is(err, ErrCancelled) {
		t.Fatalf("cancelled operation send error=%v, want ErrCancelled", err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_events WHERE operation_id=$1`, "cancel-before-send").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("cancelled operation committed %d events", count)
	}
}
func TestCircleSendRejectsAnAudienceChangedAfterEncryption(t *testing.T) {
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
	if _, err = group.Respond(ctx, a[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := contextEnvelope(t, current, "circle-message")
	if err = group.Remove(ctx, a[0], circle.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[0], raw); !errors.Is(err, ErrDenied) {
		t.Fatalf("old epoch accepted=%v", err)
	}
	var events int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM message_events").Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 0 {
		t.Fatal("rejected send persisted an event")
	}
}

func profileEnvelope(t *testing.T, current ConversationContext, operation string) string {
	t.Helper()
	var wire map[string]any
	if err := json.Unmarshal([]byte(contextEnvelope(t, current, operation)), &wire); err != nil {
		t.Fatal(err)
	}
	wire["contentType"] = "circle-profile"
	wire["profileRevision"] = 1
	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func privateProfileEnvelope(t *testing.T, current ConversationContext, operation string) string {
	t.Helper()
	var wire map[string]any
	if err := json.Unmarshal([]byte(contextEnvelope(t, current, operation)), &wire); err != nil {
		t.Fatal(err)
	}
	wire["contentType"] = "private-profile"
	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func circleMemberProfileEnvelope(t *testing.T, current ConversationContext, operation string) string {
	t.Helper()
	var wire map[string]any
	if err := json.Unmarshal([]byte(contextEnvelope(t, current, operation)), &wire); err != nil {
		t.Fatal(err)
	}
	wire["contentType"] = "circle-member-profile"
	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func nowPlayingEnvelope(t *testing.T, current ConversationContext, operation string) string {
	t.Helper()
	var wire map[string]any
	if err := json.Unmarshal([]byte(contextEnvelope(t, current, operation)), &wire); err != nil {
		t.Fatal(err)
	}
	wire["contentType"] = "now-playing"
	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestNowPlayingRelayAcceptsPrivateFriendsAndRejectsCircleRoute(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actors[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err := social.Respond(ctx, actors[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	private, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, actors[0], nowPlayingEnvelope(t, private, "now-playing-private"))
	if err != nil {
		t.Fatalf("Send(Now Playing to accepted friend) = %v", err)
	}
	inbox, err := service.Inbox(ctx, actors[1], "", 25)
	if err != nil || len(inbox.Items) != 1 || inbox.Items[0].ID != event.ID || inbox.Items[0].ContentType != "now-playing" {
		t.Fatalf("Inbox(Now Playing) = %+v,%v; want typed private update", inbox, err)
	}
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "now-playing-circle")
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := group.Invite(ctx, actors[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := group.Respond(ctx, actors[1], invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	circleContext, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, actors[0], nowPlayingEnvelope(t, circleContext, "now-playing-circle")); !errors.Is(err, ErrDenied) {
		t.Fatalf("Send(Now Playing to Circle) = %v; want denied", err)
	}
}

func TestCircleMemberProfileCanReachNonfriendCircleMember(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "member-profile-circle")
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := group.Invite(ctx, actors[0], circle.ID, "carol")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := group.Respond(ctx, actors[2], invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, actors[0], circleMemberProfileEnvelope(t, current, "member-profile-one"))
	if err != nil {
		t.Fatalf("Send(Circle member profile to nonfriend) = %v", err)
	}
	inbox, err := service.Inbox(ctx, actors[2], "", 25)
	if err != nil || len(inbox.Items) != 1 || inbox.Items[0].ID != event.ID || inbox.Items[0].ContentType != "circle-member-profile" {
		t.Fatalf("Inbox(Circle member profile) = %+v,%v; want one encrypted typed event", inbox, err)
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actors[0], "CDEFGHJK")
	if err != nil {
		t.Fatal(err)
	}
	if err := social.Respond(ctx, actors[2], request.ID, true); err != nil {
		t.Fatal(err)
	}
	private, err := service.Context(ctx, actors[0], ContextInput{TargetID: "carol"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, actors[0], circleMemberProfileEnvelope(t, private, "member-profile-private")); !errors.Is(err, ErrDenied) {
		t.Fatalf("Send(Circle member profile privately) = %v; want denied", err)
	}
}

func TestPrivateProfileUsesOnlyCurrentAcceptedFriendship(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actors[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err := social.Respond(ctx, actors[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	private, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, actors[0], privateProfileEnvelope(t, private, "private-profile-one"))
	if err != nil {
		t.Fatalf("Send(accepted private profile) = %v, want success", err)
	}
	inbox, err := service.Inbox(ctx, actors[1], "", 25)
	if err != nil || len(inbox.Items) != 1 || inbox.Items[0].ContentType != "private-profile" || inbox.Items[0].ID != event.ID {
		t.Fatalf("Inbox(private profile) = %+v,%v; want one typed event for the accepted recipient", inbox, err)
	}
	retry, err := service.Send(ctx, actors[0], privateProfileEnvelope(t, private, "private-profile-one"))
	if err != nil || retry.ID != event.ID {
		t.Fatalf("Send(exact private-profile retry) = %+v,%v; want original event", retry, err)
	}
	circle, err := circles.NewService(pool, identity).Create(ctx, actors[0], "private-profile-circle")
	if err != nil {
		t.Fatal(err)
	}
	circleService := circles.NewService(pool, identity)
	invitation, err := circleService.Invite(ctx, actors[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := circleService.Respond(ctx, actors[1], invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	circleContext, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, actors[0], privateProfileEnvelope(t, circleContext, "private-profile-circle")); !errors.Is(err, ErrDenied) {
		t.Fatalf("Send(private profile to Circle) = %v; want denied", err)
	}
	if err := social.Block(ctx, actors[0], "bob", true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"}); !errors.Is(err, ErrDenied) {
		t.Fatalf("Context(blocked private profile recipient) = %v; want denied", err)
	}
}

func TestJoinedMemberReceivesFreshProfileWithoutPrejoinContent(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	group := circles.NewService(pool, identity)
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actors[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err := social.Respond(ctx, actors[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	circle, err := group.Create(ctx, actors[0], "join-profile-circle")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	before, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, actors[0], profileEnvelope(t, before, "prejoin-profile")); err != nil {
		t.Fatal(err)
	}
	invitation, err := group.Invite(ctx, actors[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := group.Respond(ctx, actors[1], invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	inbox, err := service.Inbox(ctx, actors[1], "", 25)
	if err != nil || len(inbox.Items) != 0 {
		t.Fatalf("prejoin inbox=%+v,%v,want empty", inbox, err)
	}
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := revisionEnvelope(t, current, "fresh-current-profile", 2)
	fresh, err := service.Send(ctx, actors[0], raw)
	if err != nil {
		t.Fatal(err)
	}
	inbox, err = service.Inbox(ctx, actors[1], "", 25)
	if err != nil || len(inbox.Items) != 1 || inbox.Items[0].ID != fresh.ID {
		t.Fatalf("postjoin inbox=%+v,%v,want only fresh profile", inbox, err)
	}
	if _, err := service.Send(ctx, actors[0], raw); err != nil {
		t.Fatal(err)
	}
	if err := group.Remove(ctx, actors[0], circle.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, actors[0], revisionEnvelope(t, current, "stale-removed-audience", 3)); !errors.Is(err, ErrDenied) {
		t.Fatalf("old profile audience after removal=%v,want denied", err)
	}
}
func TestCircleProfileRequiresCurrentAdminAndRetainsTypeInDelivery(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err := social.Respond(ctx, a[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, a[0], "profile-circle")
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := group.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := group.Respond(ctx, a[1], invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	admin, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], profileEnvelope(t, admin, "admin-profile"))
	if err != nil {
		t.Fatalf("Send(admin profile) = %v, want success", err)
	}
	inbox, err := service.Inbox(ctx, a[1], "", 25)
	if err != nil || len(inbox.Items) != 1 {
		t.Fatalf("Inbox(profile) = %+v, %v, want one delivery", inbox, err)
	}
	raw, err := json.Marshal(inbox.Items[0])
	if err != nil {
		t.Fatal(err)
	}
	var delivered map[string]any
	if err := json.Unmarshal(raw, &delivered); err != nil {
		t.Fatal(err)
	}
	if delivered["contentType"] != "circle-profile" || delivered["id"] != event.ID {
		t.Fatalf("Inbox(profile routing) = %+v, want original profile type and event", delivered)
	}
	if delivered["profileRevision"] != float64(1) {
		t.Fatalf("Inbox(profile revision) = %+v, want revision1", delivered)
	}
	member, err := service.Context(ctx, a[1], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, a[1], profileEnvelope(t, member, "member-profile")); !errors.Is(err, ErrDenied) {
		t.Fatalf("Send(member profile) = %v, want denied", err)
	}
	private, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(ctx, a[0], profileEnvelope(t, private, "private-profile")); !errors.Is(err, ErrDenied) {
		t.Fatalf("Send(private profile) = %v, want denied", err)
	}
}

func TestCreatorOnlyCircleProfileHasNoDeliveriesAndCompletesReconciliation(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	circle, err := circles.NewService(pool, identity).Create(ctx, actors[0], "solo-circle")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := profileEnvelope(t, current, "solo-profile")
	event, err := service.Send(ctx, actors[0], raw)
	if err != nil {
		t.Fatalf("Send(creator-only profile) = %v, want success", err)
	}
	retry, err := service.Send(ctx, actors[0], raw)
	if err != nil || retry.ID != event.ID {
		t.Fatalf("Send(exact retry) = %+v, %v, want event %s", retry, err, event.ID)
	}
	status, err := service.Status(ctx, actors[0], event.ID)
	if err != nil || status.Status != "delivered" {
		t.Fatalf("Status(zero-recipient profile) = %+v, %v, want completed", status, err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM message_deliveries WHERE event_id=$1", event.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("Delivery count = %d, %v, want zero", count, err)
	}
	if _, err := service.Send(ctx, actors[0], contextEnvelope(t, current, "solo-text")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Send(empty text audience) = %v, want invalid", err)
	}
}

func revisionEnvelope(t *testing.T, current ConversationContext, operation string, revision int64) string {
	t.Helper()
	var wire map[string]any
	if err := json.Unmarshal([]byte(profileEnvelope(t, current, operation)), &wire); err != nil {
		t.Fatal(err)
	}
	wire["profileRevision"] = revision
	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func TestProfileRevisionRejectsStaleUpdatesAndPreservesExactRetry(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	circle, err := circles.NewService(pool, identity).Create(ctx, actors[0], "revision-circle")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.Send(ctx, actors[0], revisionEnvelope(t, current, "first-profile", 1))
	if err != nil {
		t.Fatalf("Send(revision1) = %v, want success", err)
	}
	if _, err := service.Send(ctx, actors[0], revisionEnvelope(t, current, "stale-profile", 1)); !errors.Is(err, ErrConflict) {
		t.Fatalf("Send(stale revision1) = %v, want conflict", err)
	}
	if _, err := service.Send(ctx, actors[0], revisionEnvelope(t, current, "skipped-profile", 3)); !errors.Is(err, ErrConflict) {
		t.Fatalf("Send(skipped revision3) = %v, want conflict", err)
	}
	if _, err := service.Send(ctx, actors[0], revisionEnvelope(t, current, "second-profile", 2)); err != nil {
		t.Fatalf("Send(revision2) = %v, want success", err)
	}
	retry, err := service.Send(ctx, actors[0], revisionEnvelope(t, current, "first-profile", 1))
	if err != nil || retry.ID != first.ID {
		t.Fatalf("Send(exact old retry) = %+v,%v, want original event", retry, err)
	}
	updated, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(updated)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["profileRevision"] != float64(2) {
		t.Fatalf("Context(profile revision) = %+v, want revision2", decoded)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM message_events WHERE circle_id=$1", circle.ID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("Committed profile events = %d,%v, want2", count, err)
	}
}

func TestConcurrentProfileUpdatesCommitExactlyOneRevision(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	circle, err := circles.NewService(pool, identity).Create(ctx, actors[0], "concurrent-profiles")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	first := revisionEnvelope(t, current, "competing-a", 1)
	second := revisionEnvelope(t, current, "competing-b", 1)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, raw := range []string{first, second} {
		go func(raw string) { <-start; _, err := service.Send(ctx, actors[0], raw); results <- err }(raw)
	}
	close(start)
	success, conflict := 0, 0
	for range 2 {
		err := <-results
		if err == nil {
			success++
		} else if errors.Is(err, ErrConflict) {
			conflict++
		} else {
			t.Errorf("Send(competing profile) = %v, want success or conflict", err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("Concurrent outcomes = %d success,%d conflict, want1 each", success, conflict)
	}
}
