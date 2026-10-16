package media

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSupabaseStoreUsesPrivateImmutableStorageRequests(t *testing.T) {
	ciphertext := []byte("encrypted-media")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("apikey") != "server-secret" || r.Header.Get("Authorization") != "Bearer server-secret" {
			t.Errorf("storage authorization headers missing")
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/storage/v1/object/private-media/object-1":
			if r.Header.Get("x-upsert") != "false" || r.Header.Get("Content-Type") != "application/octet-stream" {
				t.Errorf("upload headers = %v", r.Header)
			}
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, ciphertext) {
				t.Errorf("upload body = %q", body)
			}
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodGet && r.URL.Path == "/storage/v1/object/private-media/object-1":
			w.Write(ciphertext)
		case r.Method == http.MethodDelete && r.URL.Path == "/storage/v1/object/private-media":
			if r.Header.Get("Content-Type") != "application/json" {
				t.Errorf("delete content type = %q, want application/json", r.Header.Get("Content-Type"))
			}
			body, _ := io.ReadAll(r.Body)
			if string(body) != `{"prefixes":["object-1"]}` {
				t.Errorf("delete body = %s", body)
			}
			w.WriteHeader(http.StatusOK)
		default:
			t.Errorf("unexpected storage request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	store, err := NewSupabaseStore(server.URL, "server-secret", "private-media")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), "object-1", ciphertext); err != nil {
		t.Fatalf("Put() = %v", err)
	}
	got, err := store.Get(context.Background(), "object-1")
	if err != nil || !bytes.Equal(got, ciphertext) {
		t.Fatalf("Get() = %q, %v", got, err)
	}
	if err := store.Delete(context.Background(), "object-1"); err != nil {
		t.Fatalf("Delete() = %v", err)
	}
	if requests != 3 {
		t.Fatalf("storage requests = %d, want 3", requests)
	}
}

func TestSupabaseStoreConflictsOnDifferentCiphertextAtAnExistingPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			http.Error(w, `{"error":"Duplicate","message":"Asset Already Exists"}`, http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodGet {
			w.Write([]byte("different-ciphertext"))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	store, err := NewSupabaseStore(server.URL, "server-secret", "private-media")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), "object-1", []byte("new-ciphertext")); !errors.Is(err, ErrConflict) {
		t.Fatalf("Put(existing different object) = %v, want ErrConflict", err)
	}
}

func TestSupabaseStoreAcceptsExactImmutableUploadRetry(t *testing.T) {
	ciphertext := []byte("committed-ciphertext")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			http.Error(w, `{"error":"Duplicate","message":"Asset Already Exists"}`, http.StatusBadRequest)
		case http.MethodGet:
			w.Write(ciphertext)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	store, err := NewSupabaseStore(server.URL, "server-secret", "private-media")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), "object-1", ciphertext); err != nil {
		t.Fatalf("Put(exact retry) = %v, want success", err)
	}
}

func TestSupabaseStoreDoesNotForwardCredentialsAcrossRedirects(t *testing.T) {
	var destinationRequests atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		destinationRequests.Add(1)
		if r.Header.Get("apikey") != "" || r.Header.Get("Authorization") != "" {
			t.Error("Supabase credentials were forwarded across a redirect")
		}
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL+"/object", http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	store, err := NewSupabaseStore(source.URL, "server-secret", "private-media")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(context.Background(), "object-1"); err == nil {
		t.Fatal("Get(redirect) succeeded, want redirect rejected")
	}
	if got := destinationRequests.Load(); got != 0 {
		t.Fatalf("redirect destination received %d requests, want none", got)
	}
}

func TestSupabaseStoreMapsMissingObjectsAndRejectsUnsafeConfiguration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) }))
	defer server.Close()
	store, err := NewSupabaseStore(server.URL, "server-secret", "private-media")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get(missing) = %v, want ErrNotFound", err)
	}
	if err := store.Delete(context.Background(), "missing"); err == nil {
		t.Fatal("Delete(missing bucket) succeeded, want configuration/storage error")
	}
	for _, tc := range []struct{ url, key, bucket string }{
		{"http://example.invalid", "secret", "private-media"},
		{"https://example.invalid", "", "private-media"},
		{"https://example.invalid", "secret", "../public"},
	} {
		if _, err := NewSupabaseStore(tc.url, tc.key, tc.bucket); !errors.Is(err, ErrInvalid) {
			t.Errorf("NewSupabaseStore(%q, key, %q) = %v, want ErrInvalid", tc.url, tc.bucket, err)
		}
	}
}
