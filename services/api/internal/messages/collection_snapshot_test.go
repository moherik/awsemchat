package messages

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
)

func snapshotEnvelope(t *testing.T, c ConversationContext, operation, snapshot string, part, parts int, revision int64, items []map[string]string) string {
	t.Helper()
	var wire map[string]any
	if err := json.Unmarshal([]byte(contextEnvelope(t, c, operation)), &wire); err != nil {
		t.Fatal(err)
	}
	wire["contentType"] = "circle-collection-snapshot"
	wire["collectionRevision"] = revision
	wire["collectionSnapshot"] = map[string]any{"id": snapshot, "part": part, "parts": parts, "items": items}
	raw, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func TestSnapshotEnvelopeRequiresBoundedStrictMetadata(t *testing.T) {
	current := ConversationContext{Conversation: "circle", Audience: "circle:1", Sender: PeerKeys{Identity: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE", SigningIdentity: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE"}, Recipients: []RecipientBinding{}}
	raw := snapshotEnvelope(t, current, "snapshot-op", "snapshot", 0, 1, 0, []map[string]string{})
	if _, err := DecodeEnvelope(raw); err != nil {
		t.Fatalf("empty snapshot rejected: %v", err)
	}
	for _, invalid := range []string{snapshotEnvelope(t, current, "op", "snap", 1, 1, 0, []map[string]string{}), snapshotEnvelope(t, current, "op", "snap", 0, 257, 0, []map[string]string{}), snapshotEnvelope(t, current, "op", "snap", 0, 2, 0, []map[string]string{}), snapshotEnvelope(t, current, "op", "snap", 0, 1, 1, []map[string]string{{"id": "one", "kind": "sticker", "key": "private"}})} {
		if _, err := DecodeEnvelope(invalid); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid snapshot accepted: %v", err)
		}
	}
}
func TestSnapshotRelayCompletesOnlyExactCurrentTopologyWithoutChangingRevision(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	groups := circles.NewService(pool, identity)
	circle, err := groups.Create(ctx, a[0], "snapshot-circle")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	for i, id := range []string{"one", "two"} {
		if _, err = service.Send(ctx, a[0], collectionEnvelope(t, current, "add-"+id, "add", "sticker", id, int64(i+1))); err != nil {
			t.Fatal(err)
		}
	}
	firstRaw := snapshotEnvelope(t, current, "part-zero", "snapshot-one", 0, 2, 2, []map[string]string{{"id": "one", "kind": "sticker"}})
	first, err := service.Send(ctx, a[0], firstRaw)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := service.Send(ctx, a[0], firstRaw)
	if err != nil || retry.ID != first.ID {
		t.Fatalf("exact snapshot retry=%v", err)
	}
	if _, err = service.Send(ctx, a[0], snapshotEnvelope(t, current, "duplicate-item", "snapshot-one", 1, 2, 2, []map[string]string{{"id": "one", "kind": "sticker"}})); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate topology=%v", err)
	}
	var completed bool
	if err = pool.QueryRow(ctx, "SELECT completed_at IS NOT NULL FROM circle_collection_snapshots WHERE circle_id=$1 AND snapshot_id='snapshot-one'", circle.ID).Scan(&completed); err != nil || completed {
		t.Fatalf("partial completed=%v err=%v", completed, err)
	}
	if _, err = service.Send(ctx, a[0], snapshotEnvelope(t, current, "part-one", "snapshot-one", 1, 2, 2, []map[string]string{{"id": "two", "kind": "sticker"}})); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "SELECT completed_at IS NOT NULL FROM circle_collection_snapshots WHERE circle_id=$1 AND snapshot_id='snapshot-one'", circle.ID).Scan(&completed); err != nil || !completed {
		t.Fatalf("complete snapshot=%v err=%v", completed, err)
	}
	if _, err = service.Send(ctx, a[0], snapshotEnvelope(t, current, "missing-current", "missing-snapshot", 0, 1, 2, []map[string]string{{"id": "one", "kind": "sticker"}})); !errors.Is(err, ErrConflict) {
		t.Fatalf("missing topology accepted=%v", err)
	}
	var revision int64
	if err = pool.QueryRow(ctx, "SELECT collection_revision FROM circles WHERE id=$1", circle.ID).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("snapshot changed revision=%d err=%v", revision, err)
	}
	if _, err = service.Send(ctx, a[0], collectionEnvelope(t, current, "remove-two", "remove", "sticker", "two", 3)); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[0], snapshotEnvelope(t, current, "stale-snapshot", "snapshot-two", 0, 1, 2, []map[string]string{{"id": "one", "kind": "sticker"}})); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision accepted=%v", err)
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
	member, err := service.Context(ctx, a[1], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, a[1], snapshotEnvelope(t, member, "member-snapshot", "member-snapshot", 0, 1, 3, []map[string]string{{"id": "one", "kind": "sticker"}})); !errors.Is(err, ErrDenied) {
		t.Fatalf("member published snapshot=%v", err)
	}
	if _, err = service.Send(ctx, a[0], snapshotEnvelope(t, current, "old-epoch", "old-epoch", 0, 1, 3, []map[string]string{{"id": "one", "kind": "sticker"}})); !errors.Is(err, ErrDenied) {
		t.Fatalf("old membership snapshot=%v", err)
	}
}
func TestSnapshotEmptyReceiptAndJoinedMemberDeliveryKeepTypedPartMetadata(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	groups := circles.NewService(pool, identity)
	circle, err := groups.Create(ctx, a[0], "empty-snapshot")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], snapshotEnvelope(t, current, "empty-part", "empty-snapshot", 0, 1, 0, []map[string]string{}))
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := service.Status(ctx, a[0], event.ID)
	if err != nil || receipt.Status != "delivered" {
		t.Fatalf("empty snapshot receipt=%+v err=%v", receipt, err)
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
	if _, err = service.Send(ctx, a[0], snapshotEnvelope(t, current, "joined-empty-part", "new-snapshot", 0, 1, 0, []map[string]string{})); err != nil {
		t.Fatal(err)
	}
	page, err := service.Inbox(ctx, a[1], "", 25)
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("joined inbox=%+v err=%v", page, err)
	}
	raw, _ := json.Marshal(page.Items[0])
	var decoded map[string]any
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	header, ok := decoded["collectionSnapshot"].(map[string]any)
	if !ok || header["id"] != "new-snapshot" || header["part"] != float64(0) || header["parts"] != float64(1) || decoded["collectionRevision"] != float64(0) {
		t.Fatalf("snapshot delivery metadata missing: %s", raw)
	}
}
