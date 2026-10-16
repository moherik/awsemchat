package media

import (
	"bytes"
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"
)

func TestLocalStorePersistsImmutableCiphertext(t *testing.T) {
	root := t.TempDir() + "/private"
	store, err := NewLocalStore(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	want := []byte("opaque encrypted archive")
	if err := store.Put(ctx, "object-1", want); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(ctx, "object-1", want); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(ctx, "object-1", []byte("replacement")); !errors.Is(err, ErrConflict) {
		t.Fatalf("overwrite: %v", err)
	}
	reopened, err := NewLocalStore(root)
	if err != nil {
		t.Fatal(err)
	}
	got, err := reopened.Get(ctx, "object-1")
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("persisted bytes: %q, %v", got, err)
	}
	info, err := os.Stat(root + "/object-1")
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private file: %v, %v", info, err)
	}
}

func TestLocalStoreConcurrentConflictingWrites(t *testing.T) {
	store, err := NewLocalStore(t.TempDir() + "/private")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, body := range [][]byte{[]byte("first"), []byte("second")} {
		wg.Add(1)
		go func() { defer wg.Done(); results <- store.Put(context.Background(), "race", body) }()
	}
	wg.Wait()
	close(results)
	var successes, conflicts int
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestLocalStoreRejectsUnsafeIDsAndBounds(t *testing.T) {
	store, err := NewLocalStore(t.TempDir() + "/private")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", "../escape", "/absolute", "a/b", ".", ".."} {
		if err := store.Put(context.Background(), id, []byte("ciphertext")); !errors.Is(err, ErrInvalid) {
			t.Fatalf("put %q: %v", id, err)
		}
		if _, err := store.Get(context.Background(), id); !errors.Is(err, ErrInvalid) {
			t.Fatalf("get %q: %v", id, err)
		}
	}
	for _, body := range [][]byte{nil, make([]byte, 8*1024*1024+1)} {
		if err := store.Put(context.Background(), "bounded", body); !errors.Is(err, ErrInvalid) {
			t.Fatalf("bounds: %v", err)
		}
	}
	if _, err := store.Get(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := store.Put(ctx, "cancelled", []byte("ciphertext")); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled: %v", err)
	}
}

func TestLocalStoreDeleteIsIdempotentAndLeavesNoCiphertext(t *testing.T) {
	store, err := NewLocalStore(t.TempDir() + "/private")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := store.Put(ctx, "operation-object", []byte("opaque ciphertext")); err != nil {
		t.Fatal(err)
	}
	deleter, ok := any(store).(interface {
		Delete(context.Context, string) error
	})
	if !ok {
		t.Fatal("LocalStore.Delete missing")
	}
	if err := deleter.Delete(ctx, "operation-object"); err != nil {
		t.Fatal(err)
	}
	if err := deleter.Delete(ctx, "operation-object"); err != nil {
		t.Fatalf("repeat delete: %v", err)
	}
	if _, err := store.Get(ctx, "operation-object"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted object still readable: %v", err)
	}
	if err := deleter.Delete(ctx, "../outside"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe ID delete: %v", err)
	}
}

func TestLocalStoreCleansOnlyStalePendingFiles(t *testing.T) {
	store, err := NewLocalStore(t.TempDir() + "/private")
	if err != nil {
		t.Fatal(err)
	}
	stalePath := store.root + "/.pending-crashed-write"
	recentPath := store.root + "/.pending-active-write"
	unrelatedPath := store.root + "/notes.txt"
	for _, path := range []string{stalePath, recentPath, unrelatedPath} {
		if err := os.WriteFile(path, []byte("temporary"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	if err := os.Chtimes(stalePath, now.Add(-48*time.Hour), now.Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(recentPath, now.Add(-time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	removed, err := store.CleanupOrphans(context.Background())
	if err != nil || removed != 1 {
		t.Fatalf("CleanupOrphans() = %d, %v; want 1, nil", removed, err)
	}
	for _, tc := range []struct {
		path string
		want bool
	}{{stalePath, false}, {recentPath, true}, {unrelatedPath, true}} {
		_, err := os.Stat(tc.path)
		if tc.want && err != nil {
			t.Errorf("expected file %q to remain: %v", tc.path, err)
		}
		if !tc.want && !errors.Is(err, os.ErrNotExist) {
			t.Errorf("expected stale temporary %q to be removed, stat error=%v", tc.path, err)
		}
	}
}
