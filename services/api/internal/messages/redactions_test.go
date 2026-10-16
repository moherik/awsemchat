package messages

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
)

func TestPrivateRedactionIsIdempotentAndVisibleOnlyToOriginalAccounts(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), actors[0], actors[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	conversation, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	raw := contextEnvelope(t, conversation, "private-redaction")
	event, err := service.Send(ctx, actors[0], raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Redact(ctx, actors[1], RedactionTarget{EventID: event.ID}); !errors.Is(err, ErrDenied) {
		t.Fatalf("recipient redacting someone else's message=%v, want denied", err)
	}
	legacy := &LegacyMessageIdentity{Conversation: conversation.Conversation, Audience: conversation.Audience, Operation: "private-redaction", PeerKeys: conversation.Sender}
	redaction, err := service.Redact(ctx, actors[0], RedactionTarget{Legacy: legacy})
	if err != nil {
		t.Fatal(err)
	}
	retry, err := service.Redact(ctx, actors[0], RedactionTarget{EventID: event.ID})
	if err != nil || retry != redaction {
		t.Fatalf("redaction retry=%+v,%v want %+v", retry, err, redaction)
	}
	var envelope string
	var ciphertext string
	var deliveries int
	if err := pool.QueryRow(ctx, `SELECT e.envelope,d.ciphertext::text,(SELECT count(*) FROM message_deliveries WHERE event_id=e.id) FROM message_events e JOIN message_deliveries d ON d.event_id=e.id WHERE e.id=$1`, event.ID).Scan(&envelope, &ciphertext, &deliveries); err != nil {
		t.Fatal(err)
	}
	if envelope != `{}` || ciphertext != `{}` || deliveries != 1 {
		t.Fatalf("relay retained content envelope=%q ciphertext=%q deliveries=%d", envelope, ciphertext, deliveries)
	}
	page, err := service.Inbox(ctx, actors[1], "", 25)
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("redacted inbox=%+v,%v", page, err)
	}
	status, err := service.Status(ctx, actors[0], event.ID)
	if err != nil || status.Status != "redacted" {
		t.Fatalf("sender status=%+v,%v", status, err)
	}
	if _, err := service.Send(ctx, actors[0], raw); !errors.Is(err, ErrRedacted) {
		t.Fatalf("exact send retry=%v, want terminal redacted error", err)
	}
	newToken := sha256.Sum256([]byte("replacement-sender-token"))
	if _, err := pool.Exec(ctx, `UPDATE auth_accounts SET generation=2 WHERE id='alice'; UPDATE auth_sessions SET revoked_at=now() WHERE account_id='alice' AND revoked_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-alice-replacement','alice','device-alice-replacement',2,$1,now(),now()+interval '1 hour')`, newToken[:]); err != nil {
		t.Fatal(err)
	}
	replacementKey := base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("z", 32)))
	if _, err := pool.Exec(ctx, `INSERT INTO key_identities(account_id,generation,device_id,identity,signing_identity) VALUES('alice',2,'device-alice-replacement',$1,$1)`, replacementKey); err != nil {
		t.Fatal(err)
	}
	replacementSender := actors[0]
	replacementSender.SessionID = "session-alice-replacement"
	replacementSender.DeviceID = "device-alice-replacement"
	replacementSender.Generation = 2
	if _, err := service.Send(ctx, replacementSender, raw); !errors.Is(err, ErrRedacted) {
		t.Fatalf("replacement-phone stale send retry=%v, want terminal redacted error", err)
	}
	for _, actor := range []int{0, 1} {
		principal := actors[actor]
		if actor == 0 {
			principal = replacementSender
		}
		feed, err := service.Redactions(ctx, principal, "", 25)
		if err != nil || len(feed.Items) != 1 || feed.Items[0].EventID != event.ID {
			t.Fatalf("original account %d redactions=%+v,%v", actor, feed, err)
		}
		if _, err := service.Redactions(ctx, principal, feed.Cursor, 25); err != nil {
			t.Fatalf("valid account cursor rejected: %v", err)
		}
	}
	outsider, err := service.Redactions(ctx, actors[2], "", 25)
	if err != nil || len(outsider.Items) != 0 {
		t.Fatalf("outsider redactions=%+v,%v", outsider, err)
	}
	if _, err := service.Redactions(ctx, actors[2], redaction.Cursor, 25); !errors.Is(err, ErrInvalid) {
		t.Fatalf("foreign account cursor=%v, want invalid", err)
	}
	var metadata map[string]any
	encoded, _ := json.Marshal(redaction)
	if json.Unmarshal(encoded, &metadata) != nil || len(metadata) != 6 {
		t.Fatalf("unexpected redaction metadata fields: %s", encoded)
	}
}

func TestRedactionFeedPagesAreAccountScopedAndReplacementSafe(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), actors[0], actors[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	conversation, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 2)
	for i, operation := range []string{"redaction-page-one", "redaction-page-two"} {
		event, err := service.Send(ctx, actors[0], contextEnvelope(t, conversation, operation))
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = event.ID
		if _, err := service.Redact(ctx, actors[0], RedactionTarget{EventID: event.ID}); err != nil {
			t.Fatal(err)
		}
	}
	first, err := service.Redactions(ctx, actors[1], "", 1)
	if err != nil || len(first.Items) != 1 || !first.More || first.Items[0].EventID != ids[0] {
		t.Fatalf("first recipient page=%+v,%v", first, err)
	}
	second, err := service.Redactions(ctx, actors[1], first.Cursor, 1)
	if err != nil || len(second.Items) != 1 || second.More || second.Items[0].EventID != ids[1] {
		t.Fatalf("second recipient page=%+v,%v", second, err)
	}
	newSessionToken := []byte("replacement-redaction-token")
	digest := sha256.Sum256(newSessionToken)
	if _, err := pool.Exec(ctx, `UPDATE auth_accounts SET generation=2 WHERE id='bob'; UPDATE auth_sessions SET revoked_at=now() WHERE account_id='bob' AND revoked_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-bob-replacement','bob','device-bob-replacement',2,$1,now(),now()+interval '1 hour')`, digest[:]); err != nil {
		t.Fatal(err)
	}
	replacement := actors[1]
	replacement.SessionID = "session-bob-replacement"
	replacement.DeviceID = "device-bob-replacement"
	replacement.Generation = 2
	recovered, err := service.Redactions(ctx, replacement, "", 25)
	if err != nil || len(recovered.Items) != 2 {
		t.Fatalf("replacement phone feed=%+v,%v", recovered, err)
	}
}

func TestCircleRedactionUsesOriginalAudienceAfterLeaveAndRejoinChanges(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	accept(t, social, actors[0], actors[1], "BCDEFGHJ")
	accept(t, social, actors[0], actors[2], "CDEFGHJK")
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "redaction-circle")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := group.Invite(ctx, actors[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := group.Respond(ctx, actors[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	conversation, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, actors[0], contextEnvelope(t, conversation, "circle-redaction"))
	if err != nil {
		t.Fatal(err)
	}
	if err := group.Leave(ctx, actors[1], circle.ID); err != nil {
		t.Fatal(err)
	}
	invite, err = group.Invite(ctx, actors[0], circle.ID, "carol")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := group.Respond(ctx, actors[2], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Redact(ctx, actors[0], RedactionTarget{EventID: event.ID}); err != nil {
		t.Fatal(err)
	}
	former, err := service.Redactions(ctx, actors[1], "", 25)
	if err != nil || len(former.Items) != 1 || former.Items[0].EventID != event.ID {
		t.Fatalf("former original member redactions=%+v,%v", former, err)
	}
	late, err := service.Redactions(ctx, actors[2], "", 25)
	if err != nil || len(late.Items) != 0 {
		t.Fatalf("later joiner redactions=%+v,%v", late, err)
	}
	var audienceCount, originalDeliveryCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_redaction_feed WHERE event_id=$1`, event.ID).Scan(&audienceCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_deliveries WHERE event_id=$1 AND ciphertext='{}'::jsonb`, event.ID).Scan(&originalDeliveryCount); err != nil {
		t.Fatal(err)
	}
	if audienceCount != 2 || originalDeliveryCount != 1 {
		t.Fatalf("redaction feed=%d original cleared deliveries=%d; want sender+original recipient and preserved one delivery row", audienceCount, originalDeliveryCount)
	}
}

func TestRedactionControlEventCannotBeDeletedAsChatMessage(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), actors[0], actors[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	conversation, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := DecodeEnvelope(contextEnvelope(t, conversation, "delete-control"))
	if err != nil {
		t.Fatal(err)
	}
	envelope.ContentType = "redaction-control"
	raw, _ := json.Marshal(envelope)
	event, err := service.Send(ctx, actors[0], string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Redact(ctx, actors[0], RedactionTarget{EventID: event.ID}); !errors.Is(err, ErrDenied) {
		t.Fatalf("control-event redaction=%v, want denied", err)
	}
}

func TestLegacyRedactionRejectsAmbiguousDescriptorAndMissingEvent(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	accept(t, friends.NewService(pool, identity), actors[0], actors[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	conversation, err := service.Context(ctx, actors[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, actors[0], contextEnvelope(t, conversation, "ambiguous-redaction"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO message_events(id,sender_id,sender_generation,operation_id,conversation,audience,digest,envelope) SELECT 'ambiguous-event',sender_id,99,operation_id,conversation,audience,digest,envelope FROM message_events WHERE id=$1`, event.ID); err != nil {
		t.Fatal(err)
	}
	legacy := &LegacyMessageIdentity{Conversation: conversation.Conversation, Audience: conversation.Audience, Operation: "ambiguous-redaction", PeerKeys: conversation.Sender}
	if _, err := service.Redact(ctx, actors[0], RedactionTarget{Legacy: legacy}); !errors.Is(err, ErrConflict) {
		t.Fatalf("ambiguous legacy descriptor=%v, want conflict", err)
	}
	if _, err := service.Redact(ctx, actors[0], RedactionTarget{EventID: "missing-redaction-event"}); !errors.Is(err, ErrDenied) {
		t.Fatalf("missing event=%v, want denied", err)
	}
	if _, err := service.Redact(ctx, actors[0], RedactionTarget{Legacy: &LegacyMessageIdentity{Conversation: conversation.Conversation}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("malformed legacy descriptor=%v, want invalid", err)
	}
}

func TestConcurrentCircleRedactionsSerializeOverlappingFeedCursors(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	accept(t, social, actors[0], actors[1], "BCDEFGHJ")
	accept(t, social, actors[0], actors[2], "CDEFGHJK")
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "concurrent-redactions")
	if err != nil {
		t.Fatal(err)
	}
	for index, account := range []string{"bob", "carol"} {
		invite, err := group.Invite(ctx, actors[0], circle.ID, account)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := group.Respond(ctx, actors[index+1], invite.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(pool, identity)
	conversation, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 2)
	for i, operation := range []string{"circle-concurrent-one", "circle-concurrent-two"} {
		event, err := service.Send(ctx, actors[0], contextEnvelope(t, conversation, operation))
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = event.ID
	}
	start := make(chan struct{})
	results := make(chan error, len(ids))
	var workers sync.WaitGroup
	for _, id := range ids {
		workers.Add(1)
		go func(eventID string) {
			defer workers.Done()
			<-start
			_, err := service.Redact(ctx, actors[0], RedactionTarget{EventID: eventID})
			results <- err
		}(id)
	}
	close(start)
	workers.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	page, err := service.Redactions(ctx, actors[0], "", 1)
	if err != nil || len(page.Items) != 1 || !page.More {
		t.Fatalf("first concurrent feed page=%+v,%v", page, err)
	}
	next, err := service.Redactions(ctx, actors[0], page.Cursor, 1)
	if err != nil || len(next.Items) != 1 || next.More || next.Items[0].EventID == page.Items[0].EventID {
		t.Fatalf("second concurrent feed page=%+v,%v", next, err)
	}
}
