package messages

import (
	"context"
	"testing"
	"time"

	"awsemchat/services/api/internal/friends"
)

func TestInboxCursorCannotSkipAQueueEntryThatCommitsLate(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	social := friends.NewService(pool, identity)
	accept(t, social, a[0], a[1], "BCDEFGHJ")
	accept(t, social, a[2], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	slow, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	fast, err := service.Context(ctx, a[2], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `CREATE FUNCTION delay_slow_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT operation_id FROM message_events WHERE id=NEW.event_id)='slow' THEN PERFORM pg_advisory_xact_lock(9757391::bigint); END IF; RETURN NEW; END $$; CREATE TRIGGER delayed_delivery BEFORE INSERT ON message_deliveries FOR EACH ROW EXECUTE FUNCTION delay_slow_delivery()`)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Rollback(context.Background())
	if _, err = gate.Exec(ctx, "SELECT pg_advisory_xact_lock(9757391::bigint)"); err != nil {
		t.Fatal(err)
	}
	slowWire, fastWire := contextEnvelope(t, slow, "slow"), contextEnvelope(t, fast, "fast")
	slowResult := make(chan error, 1)
	go func() { _, err := service.Send(ctx, a[0], slowWire); slowResult <- err }()
	for {
		var waiting bool
		if err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=9757391 AND NOT granted)").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("slow delivery did not reach the gate")
		case <-time.After(10 * time.Millisecond):
		}
	}
	fastResult := make(chan error, 1)
	go func() { _, err := service.Send(ctx, a[2], fastWire); fastResult <- err }()
	fastFinished := false
	select {
	case err := <-fastResult:
		if err != nil {
			t.Fatal(err)
		}
		fastFinished = true
	case <-time.After(250 * time.Millisecond):
	}
	first, err := service.Inbox(ctx, a[1], "", 25)
	if err != nil {
		t.Fatal(err)
	}
	if err = gate.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-slowResult; err != nil {
		t.Fatal(err)
	}
	if !fastFinished {
		if err = <-fastResult; err != nil {
			t.Fatal(err)
		}
	}
	second, err := service.Inbox(ctx, a[1], first.Cursor, 25)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items)+len(second.Items) != 2 {
		t.Fatalf("cursor skipped late commit: first=%d second=%d", len(first.Items), len(second.Items))
	}
}
