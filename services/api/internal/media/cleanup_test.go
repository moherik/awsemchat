package media

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"testing"
	"time"
)

type failingDeleteStorage struct {
	Storage
	fail bool
}

func (s *failingDeleteStorage) Delete(ctx context.Context, id string) error {
	if s.fail {
		s.fail = false
		return errors.New("temporary storage outage")
	}
	return s.Storage.Delete(ctx, id)
}

func TestCleanupRetriesDeleteFailureAndSurvivesServiceRecreation(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "cleanup-retry")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "retry-object", "retry-op", []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CancelOperation(ctx, actor, circle.ID, "retry-op"); err != nil {
		t.Fatal(err)
	}
	storage := &failingDeleteStorage{Storage: s.storage, fail: true}
	s.storage = storage
	if _, err := s.DrainCleanup(ctx, 1); err == nil {
		t.Fatal("transient storage failure was hidden")
	}
	var state string
	if err := pool.QueryRow(ctx, "SELECT state FROM circle_media_cleanup WHERE object_id='retry-object'").Scan(&state); err != nil || state != "pending" {
		t.Fatalf("failed delete state=%q err=%v", state, err)
	}
	restarted := NewService(s.pool, s.auth, storage)
	completed, err := restarted.DrainCleanup(ctx, 1)
	if err != nil || completed != 1 {
		t.Fatalf("recovered cleanup count=%d err=%v", completed, err)
	}
	if _, err := storage.Get(ctx, "retry-object"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ciphertext remains after cleanup: %v", err)
	}
	if err := pool.QueryRow(ctx, "SELECT state FROM circle_media_cleanup WHERE object_id='retry-object'").Scan(&state); err != nil || state != "complete" {
		t.Fatalf("completed delete state=%q err=%v", state, err)
	}
}

func TestCleanupDrainsOnlyRequestedBatchAndMissingObjectIsSuccess(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "cleanup-batch")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"batch-one", "batch-two"} {
		if err := s.PutCircle(ctx, actor, circle.ID, 1, id, "batch-op", []byte("opaque")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.CancelOperation(ctx, actor, circle.ID, "batch-op"); err != nil {
		t.Fatal(err)
	}
	if err := s.storage.Delete(ctx, "batch-one"); err != nil {
		t.Fatal(err)
	}
	completed, err := s.DrainCleanup(ctx, 1)
	if err != nil || completed != 1 {
		t.Fatalf("first batch count=%d err=%v", completed, err)
	}
	var complete, pending int
	if err := pool.QueryRow(ctx, "SELECT count(*) FILTER (WHERE state='complete'),count(*) FILTER (WHERE state='pending') FROM circle_media_cleanup").Scan(&complete, &pending); err != nil {
		t.Fatal(err)
	}
	if complete != 1 || pending != 1 {
		t.Fatalf("batch states complete=%d pending=%d", complete, pending)
	}
	completed, err = s.DrainCleanup(ctx, 1)
	if err != nil || completed != 1 {
		t.Fatalf("second batch count=%d err=%v", completed, err)
	}
}

func TestPrivateCleanupRetriesAfterServiceRecreation(t *testing.T) {
	s, _, pool, actor := fixture(t)
	ctx := context.Background()
	digest := sha256.Sum256([]byte("bob"))
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',$1,'BCDEFGHJ',1)", digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES('alice','bob','friend-cleanup','alice','accepted')"); err != nil {
		t.Fatal(err)
	}
	if err := s.PutPrivate(ctx, actor, "bob", "friend:friend-cleanup", "private-retry-object", "private-retry-op", []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CancelPrivateOperation(ctx, actor, "bob", "friend:friend-cleanup", "private-retry-op"); err != nil {
		t.Fatal(err)
	}
	storage := &failingDeleteStorage{Storage: s.storage, fail: true}
	s.storage = storage
	if _, err := s.DrainCleanup(ctx, 1); err == nil {
		t.Fatal("transient private-media deletion failure was hidden")
	}
	var state string
	if err := pool.QueryRow(ctx, "SELECT state FROM private_media_cleanup WHERE object_id='private-retry-object'").Scan(&state); err != nil || state != "pending" {
		t.Fatalf("failed private cleanup state=%q err=%v", state, err)
	}
	restarted := NewService(s.pool, s.auth, storage)
	completed, err := restarted.DrainCleanup(ctx, 1)
	if err != nil || completed != 1 {
		t.Fatalf("recovered private cleanup count=%d err=%v", completed, err)
	}
	if _, err := storage.Get(ctx, "private-retry-object"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("private ciphertext remains after cleanup: %v", err)
	}
	if err := pool.QueryRow(ctx, "SELECT state FROM private_media_cleanup WHERE object_id='private-retry-object'").Scan(&state); err != nil || state != "complete" {
		t.Fatalf("completed private cleanup state=%q err=%v", state, err)
	}
}

func TestCleanupWorkerRemovesStaleLocalPendingFiles(t *testing.T) {
	s, _, _, _ := fixture(t)
	store, ok := s.storage.(*LocalStore)
	if !ok {
		t.Fatalf("fixture storage = %T, want *LocalStore", s.storage)
	}
	path := store.root + "/.pending-interrupted-upload"
	if err := os.WriteFile(path, []byte("partial ciphertext"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.RunCleanup(ctx)
		close(done)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		_, err := os.Stat(path)
		if errors.Is(err, os.ErrNotExist) {
			break
		}
		if err != nil {
			cancel()
			<-done
			t.Fatal(err)
		}
		if time.Now().After(deadline) {
			cancel()
			<-done
			t.Fatal("cleanup worker left a stale local temporary file")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
}
