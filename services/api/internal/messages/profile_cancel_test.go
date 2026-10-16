package messages

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"awsemchat/services/api/internal/circles"
)

func TestProfileCancellationFencesExactOperationWithoutChangingCircleRevision(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "cancel-profile")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := profileEnvelope(t, current, "cancel-one")
	result, err := service.CancelProfile(ctx, actors[0], raw)
	if err != nil || result.State != "cancelled" || result.Event != nil {
		t.Fatalf("cancel=%+v %v", result, err)
	}
	retry, err := service.CancelProfile(ctx, actors[0], raw)
	if err != nil || retry.State != "cancelled" {
		t.Fatalf("retry=%+v %v", retry, err)
	}
	if _, err := service.Send(ctx, actors[0], raw); !errors.Is(err, ErrCancelled) {
		t.Fatalf("late send=%v", err)
	}
	changed := profileEnvelope(t, current, "cancel-one") + " "
	if _, err := service.CancelProfile(ctx, actors[0], changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed cancel=%v", err)
	}
	if _, err := service.Send(ctx, actors[0], changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed send=%v", err)
	}
	var revision int64
	if err := pool.QueryRow(ctx, "SELECT profile_revision FROM circles WHERE id=$1", circle.ID).Scan(&revision); err != nil || revision != 0 {
		t.Fatalf("revision=%d %v", revision, err)
	}
	if err := group.Leave(ctx, actors[0], circle.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CancelProfile(ctx, actors[0], raw); err != nil {
		t.Fatalf("cancel recovery after closure=%v", err)
	}
}

func TestCollectionCancellationFencesExactQueuedOperation(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "cancel-collection")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := collectionEnvelope(t, current, "cancel-item", "add", "sticker", "item-one", 1)
	result, err := service.CancelCollection(ctx, actors[0], raw)
	if err != nil || result.State != "cancelled" {
		t.Fatalf("cancel=%+v %v", result, err)
	}
	if _, err := service.Send(ctx, actors[0], raw); !errors.Is(err, ErrCancelled) {
		t.Fatalf("late send=%v", err)
	}
	changed := collectionEnvelope(t, current, "cancel-item", "add", "sticker", "item-two", 1)
	if _, err := service.CancelCollection(ctx, actors[0], changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed cancel=%v", err)
	}
	if _, err := service.CancelCollection(ctx, actors[1], raw); !errors.Is(err, ErrDenied) {
		t.Fatalf("other account cancel=%v", err)
	}
}

func TestProfileCancelSendRaceHasOneAuthoritativeOutcome(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "race-profile")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := profileEnvelope(t, current, "race-one")
	var sent Event
	var sendErr, errorCancel error
	var cancelled ProfileCancellation
	var wg sync.WaitGroup
	wg.Add(2)
	start := make(chan struct{})
	go func() { defer wg.Done(); <-start; sent, sendErr = service.Send(ctx, actors[0], raw) }()
	go func() { defer wg.Done(); <-start; cancelled, errorCancel = service.CancelProfile(ctx, actors[0], raw) }()
	close(start)
	wg.Wait()
	if errorCancel != nil {
		t.Fatal(errorCancel)
	}
	switch cancelled.State {
	case "committed":
		if sendErr != nil || cancelled.Event == nil || *cancelled.Event != sent {
			t.Fatalf("commit=%+v send=%+v err=%v", cancelled, sent, sendErr)
		}
	case "cancelled":
		if !errors.Is(sendErr, ErrCancelled) {
			t.Fatalf("fenced send=%v", sendErr)
		}
	default:
		t.Fatalf("outcome=%+v", cancelled)
	}
	retry, err := service.CancelProfile(ctx, actors[0], raw)
	if err != nil || retry.State != cancelled.State {
		t.Fatalf("stable outcome=%+v %v", retry, err)
	}
}

func TestProfileCancellationHTTPAndCommittedEventPreservation(t *testing.T) {
	pool, identity, actors := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='alice'", digest[:]); err != nil {
		t.Fatal(err)
	}
	group := circles.NewService(pool, identity)
	circle, err := group.Create(ctx, actors[0], "http-cancel")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, actors[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := profileEnvelope(t, current, "committed-profile")
	event, err := service.Send(ctx, actors[0], raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := group.Leave(ctx, actors[0], circle.ID); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{"envelope": raw})
	handler := NewHandler(service)
	call := func(body, auth string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/v1/messages/profiles/cancel", strings.NewReader(body))
		if auth != "" {
			r.Header.Set("Authorization", "Bearer "+auth)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call(string(payload), ""); w.Code != 401 {
		t.Fatalf("anonymous=%d", w.Code)
	}
	if w := call(`{"envelope":"bad","actorId":"bob"}`, token); w.Code != 400 {
		t.Fatalf("spoofed=%d", w.Code)
	}
	w := call(string(payload), token)
	var outcome ProfileCancellation
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &outcome) != nil || outcome.State != "committed" || outcome.Event == nil || *outcome.Event != event {
		t.Fatalf("committed=%d %s", w.Code, w.Body.String())
	}
	if _, err := service.CancelProfile(ctx, actors[1], contextEnvelope(t, current, "ordinary-text")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("text cancel=%v", err)
	}
}
