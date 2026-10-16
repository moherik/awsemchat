package keys

import (
	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestPrivateAllocationRequiresConsentAndPreservesOneKeyPerOperation(t *testing.T) {
	pool, identity, target := keyDatabase(t)
	ctx := context.Background()
	for _, sql := range []string{
		`INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',decode(repeat('44',32),'hex'),'BCDEFGHJ',1)`,
		`INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-bob','bob','device-bob',1,decode(repeat('45',32),'hex'),now(),now()+interval '1 hour')`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	actor := auth.Principal{AccountID: "bob", SessionID: "session-bob", DeviceID: "device-bob", Generation: 1}
	service := NewService(pool, identity)
	r := registration(t, target, []Bundle{signed(t, nil)})
	if err := service.Publish(ctx, target, r, time.Unix(1000, 0)); err != nil {
		t.Fatal(err)
	}
	input := AllocationRequest{OperationID: "allocate-one", TargetID: "alice"}
	if _, err := service.Allocate(ctx, actor, input, time.Unix(1000, 0)); !errors.Is(err, ErrDenied) {
		t.Fatalf("no consent=%v", err)
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actor, "ABCDEFGH")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, target, request.ID, true); err != nil {
		t.Fatal(err)
	}
	first, err := service.Allocate(ctx, actor, input, time.Unix(1000, 0))
	if err != nil {
		t.Fatal(err)
	}
	again, err := service.Allocate(ctx, actor, input, time.Unix(1001, 0))
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(first)
	b, _ := json.Marshal(again)
	if string(a) != string(b) || first.Generation != 1 || first.Bundle.KeyID != r.Bundles[0].KeyID {
		t.Fatal("allocation retry changed key")
	}
	input.OperationID = "allocate-two"
	if _, err := service.Allocate(ctx, actor, input, time.Unix(1000, 0)); !errors.Is(err, ErrExhausted) {
		t.Fatalf("reissued key=%v", err)
	}
	if err := social.Block(ctx, actor, "alice", true); err != nil {
		t.Fatal(err)
	}
	input.OperationID = "allocate-one"
	if _, err := service.Allocate(ctx, actor, input, time.Unix(1001, 0)); !errors.Is(err, ErrDenied) {
		t.Fatalf("blocked retry=%v", err)
	}
}

func TestConcurrentPeersCannotAllocateTheSamePrekey(t *testing.T) {
	pool, identity, target := keyDatabase(t)
	ctx := context.Background()
	service := NewService(pool, identity)
	if err := service.Publish(ctx, target, registration(t, target, []Bundle{signed(t, nil)}), time.Unix(1000, 0)); err != nil {
		t.Fatal(err)
	}
	social := friends.NewService(pool, identity)
	actors := make([]auth.Principal, 3)
	for i, id := range []string{"bob", "carol", "dave"} {
		digest := sha256.Sum256([]byte(id))
		token := sha256.Sum256([]byte("token-" + id))
		if _, err := pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES($1,$2,$3,1)`, id, digest[:], []string{"BCDEFGHJ", "CDEFGHJK", "DEFGHJKL"}[i]); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES($1,$2,$3,1,$4,now(),now()+interval '1 hour')`, "session-"+id, id, "device-"+id, token[:]); err != nil {
			t.Fatal(err)
		}
		actors[i] = auth.Principal{AccountID: id, SessionID: "session-" + id, DeviceID: "device-" + id, Generation: 1}
		request, err := social.Request(ctx, actors[i], "ABCDEFGH")
		if err != nil {
			t.Fatal(err)
		}
		if err = social.Respond(ctx, target, request.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	results := make(chan error, 3)
	var wg sync.WaitGroup
	for _, actor := range actors {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := service.Allocate(ctx, actor, AllocationRequest{OperationID: "initial", TargetID: "alice"}, time.Unix(1000, 0))
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	successes, exhausted := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrExhausted) {
			exhausted++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || exhausted != 2 {
		t.Fatalf("successes=%d exhausted=%d", successes, exhausted)
	}
}

func TestCircleAllocationRequiresCurrentEpochAndBothActiveMembers(t *testing.T) {
	pool, identity, target := keyDatabase(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',decode(repeat('44',32),'hex'),'BCDEFGHJ',1); INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-bob','bob','device-bob',1,decode(repeat('45',32),'hex'),now(),now()+interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	actor := auth.Principal{AccountID: "bob", SessionID: "session-bob", DeviceID: "device-bob", Generation: 1}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actor, "ABCDEFGH")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, target, request.ID, true); err != nil {
		t.Fatal(err)
	}
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, target, "circle-one")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := group.Invite(ctx, target, circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = group.Respond(ctx, actor, invite.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = social.Block(ctx, actor, "alice", true); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	r := registration(t, target, []Bundle{signed(t, nil)})
	if err = service.Publish(ctx, target, r, time.Unix(1000, 0)); err != nil {
		t.Fatal(err)
	}
	input := AllocationRequest{OperationID: "circle-key", TargetID: "alice", CircleID: circle.ID, Epoch: 2}
	if _, err = service.Allocate(ctx, actor, input, time.Unix(1000, 0)); err != nil {
		t.Fatalf("active Circle despite private block=%v", err)
	}
	input.Epoch = 1
	if _, err = service.Allocate(ctx, actor, input, time.Unix(1000, 0)); !errors.Is(err, ErrDenied) {
		t.Fatalf("stale epoch=%v", err)
	}
	input.Epoch = 2
	if err = group.Remove(ctx, target, circle.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Allocate(ctx, actor, input, time.Unix(1000, 0)); !errors.Is(err, ErrDenied) {
		t.Fatalf("removed retry=%v", err)
	}
}
