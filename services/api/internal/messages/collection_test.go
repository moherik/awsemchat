package messages

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
)

func collectionEnvelope(t *testing.T, current ConversationContext, operation, action, kind, item string, revision int64) string {
	t.Helper()
	var wire map[string]any
	if err := json.Unmarshal([]byte(contextEnvelope(t, current, operation)), &wire); err != nil {
		t.Fatal(err)
	}
	wire["contentType"] = "circle-collection"
	wire["collectionRevision"] = revision
	wire["collectionChange"] = map[string]any{"action": action, "kind": kind, "item": item}
	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func TestCollectionEnvelopeKeepsStrictTypedRouting(t *testing.T) {
	base := map[string]any{}
	if err := json.Unmarshal([]byte(wire(t)), &base); err != nil {
		t.Fatal(err)
	}
	base["contentType"] = "circle-collection"
	base["collectionRevision"] = 1
	base["collectionChange"] = map[string]any{"action": "add", "kind": "sticker", "item": "item-one"}
	raw, _ := json.Marshal(base)
	if _, err := DecodeEnvelope(string(raw)); err != nil {
		t.Fatalf("valid collection rejected: %v", err)
	}
	for _, change := range []map[string]any{{"action": "edit", "kind": "sticker", "item": "item-one"}, {"action": "add", "kind": "unknown", "item": "item-one"}, {"action": "add", "kind": "emoji", "item": "bad id"}, {"action": "add", "kind": "emoji", "item": "item-one", "key": "private"}} {
		base["collectionChange"] = change
		invalid, _ := json.Marshal(base)
		if _, err := DecodeEnvelope(string(invalid)); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid change accepted: %v", err)
		}
	}
	base["collectionChange"] = map[string]any{"action": "add", "kind": "emoji", "item": "item-one"}
	base["collectionRevision"] = 0
	invalid, _ := json.Marshal(base)
	if _, err := DecodeEnvelope(string(invalid)); !errors.Is(err, ErrInvalid) {
		t.Fatal("zero revision accepted")
	}
	base["collectionRevision"] = 1
	base["contentType"] = "text"
	invalid, _ = json.Marshal(base)
	if _, err := DecodeEnvelope(string(invalid)); !errors.Is(err, ErrInvalid) {
		t.Fatal("collection metadata on text accepted")
	}
}
func TestCircleCollectionContributionsAdminRemovalAndImmutableIDs(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, a[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	groups := circles.NewService(pool, identity)
	circle, err := groups.Create(ctx, a[0], "collections-circle")
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := groups.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = groups.Respond(ctx, a[1], invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	member, err := service.Context(ctx, a[1], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := collectionEnvelope(t, member, "member-add", "add", "sticker", "sticker-one", 1)
	first, err := service.Send(ctx, a[1], raw)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := service.Send(ctx, a[1], raw)
	if err != nil || retry.ID != first.ID {
		t.Fatalf("exact retry changed: %v", err)
	}
	if _, err = service.Send(ctx, a[1], collectionEnvelope(t, member, "member-remove", "remove", "sticker", "sticker-one", 2)); !errors.Is(err, ErrDenied) {
		t.Fatalf("member removal=%v", err)
	}
	admin, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[0], collectionEnvelope(t, admin, "wrong-kind", "remove", "emoji", "sticker-one", 2)); !errors.Is(err, ErrConflict) {
		t.Fatalf("wrong item kind=%v", err)
	}
	if _, err = service.Send(ctx, a[0], collectionEnvelope(t, admin, "admin-remove", "remove", "sticker", "sticker-one", 2)); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[1], collectionEnvelope(t, member, "reuse-item", "add", "sticker", "sticker-one", 3)); !errors.Is(err, ErrConflict) {
		t.Fatalf("removed item ID reused=%v", err)
	}
	var revision, profile int64
	var deleted bool
	if err = pool.QueryRow(ctx, "SELECT collection_revision,profile_revision FROM circles WHERE id=$1", circle.ID).Scan(&revision, &profile); err != nil || revision != 2 || profile != 0 {
		t.Fatalf("revision=%d profile=%d error=%v", revision, profile, err)
	}
	if err = pool.QueryRow(ctx, "SELECT removed_revision IS NOT NULL FROM circle_collection_items WHERE circle_id=$1 AND item_id='sticker-one'", circle.ID).Scan(&deleted); err != nil || !deleted {
		t.Fatalf("item tombstone=%v error=%v", deleted, err)
	}
	if err = groups.Remove(ctx, a[0], circle.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	retry, err = service.Send(ctx, a[1], raw)
	if err != nil || retry.ID != first.ID {
		t.Fatalf("accepted operation after removal lost: %v", err)
	}
	if _, err = service.Send(ctx, a[1], collectionEnvelope(t, member, "removed-add", "add", "emoji", "new-emoji", 3)); !errors.Is(err, ErrDenied) {
		t.Fatalf("removed member contribution=%v", err)
	}

}

func TestCollectionDeliveryAndCreatorOnlyReceiptRetainTypedMetadata(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	groups := circles.NewService(pool, identity)
	circle, err := groups.Create(ctx, a[0], "solo-collection")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := collectionEnvelope(t, current, "solo-add", "add", "emoji", "emoji-one", 1)
	event, err := service.Send(ctx, a[0], raw)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := service.Status(ctx, a[0], event.ID)
	if err != nil || receipt.Status != "delivered" {
		t.Fatalf("solo collection receipt=%+v error=%v", receipt, err)
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, a[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	invite, err := groups.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = groups.Respond(ctx, a[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	current, err = service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[0], collectionEnvelope(t, current, "shared-remove", "remove", "emoji", "emoji-one", 2)); err != nil {
		t.Fatal(err)
	}
	page, err := service.Inbox(ctx, a[1], "", 25)
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("inbox=%+v error=%v", page, err)
	}
	encoded, _ := json.Marshal(page.Items[0])
	var delivery map[string]any
	json.Unmarshal(encoded, &delivery)
	change, ok := delivery["collectionChange"].(map[string]any)
	if delivery["contentType"] != "circle-collection" || delivery["collectionRevision"] != float64(2) || !ok || change["action"] != "remove" || change["kind"] != "emoji" || change["item"] != "emoji-one" {
		t.Fatalf("collection routing missing from delivery: %s", encoded)
	}
}

func TestCollectionRevisionsSerializeWithoutProfileLockUpgradeDeadlock(t *testing.T) {
	for _, withProfile := range []bool{false, true} {
		t.Run(map[bool]string{false: "competing-collection-revision", true: "independent-profile-revision"}[withProfile], func(t *testing.T) {
			pool, identity, a := messageDatabase(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			circle, err := circles.NewService(pool, identity).Create(ctx, a[0], "concurrent-collection")
			if err != nil {
				t.Fatal(err)
			}
			service := NewService(pool, identity)
			current, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
			if err != nil {
				t.Fatal(err)
			}
			raws := []string{collectionEnvelope(t, current, "collection-first", "add", "sticker", "first", 1), collectionEnvelope(t, current, "collection-second", "add", "emoji", "second", 1)}
			if withProfile {
				raws[1] = profileEnvelope(t, current, "profile-first")
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			for _, raw := range raws {
				go func(raw string) { <-start; _, err := service.Send(ctx, a[0], raw); results <- err }(raw)
			}
			close(start)
			accepted, conflicts := 0, 0
			for range 2 {
				err := <-results
				if err == nil {
					accepted++
				} else if errors.Is(err, ErrConflict) {
					conflicts++
				} else {
					t.Fatalf("concurrent metadata failed: %v", err)
				}
			}
			if withProfile && accepted != 2 || !withProfile && (accepted != 1 || conflicts != 1) {
				t.Fatalf("accepted=%d conflicts=%d", accepted, conflicts)
			}
		})
	}
}

func TestCollectionHTTPRequiresSessionAndUsesCurrentRole(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='bob'", digest[:]); err != nil {
		t.Fatal(err)
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, a[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	groups := circles.NewService(pool, identity)
	circle, err := groups.Create(ctx, a[0], "http-collection")
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := groups.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = groups.Respond(ctx, a[1], invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[1], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service)
	call := func(raw string, authenticated bool) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"envelope": raw})
		r := httptest.NewRequest("POST", "/v1/messages", strings.NewReader(string(body)))
		if authenticated {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	raw := collectionEnvelope(t, current, "http-add", "add", "emoji", "http-emoji", 1)
	if result := call(raw, false); result.Code != 401 {
		t.Fatalf("anonymous contribution=%d %s", result.Code, result.Body.String())
	}
	if result := call(raw, true); result.Code != 200 {
		t.Fatalf("member contribution=%d %s", result.Code, result.Body.String())
	}
	if result := call(collectionEnvelope(t, current, "http-remove", "remove", "emoji", "http-emoji", 2), true); result.Code != 403 {
		t.Fatalf("member removal=%d %s", result.Code, result.Body.String())
	}
	private, err := service.Context(ctx, a[1], ContextInput{TargetID: "alice"})
	if err != nil {
		t.Fatal(err)
	}
	if result := call(collectionEnvelope(t, private, "private-collection", "add", "sticker", "private-item", 1), true); result.Code != 403 {
		t.Fatalf("private collection=%d %s", result.Code, result.Body.String())
	}
}
