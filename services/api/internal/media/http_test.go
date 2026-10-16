package media

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"awsemchat/services/api/internal/messages"
)

func TestHTTPMediaAuthenticatesBoundsAndReturnsOpaqueBytes(t *testing.T) {
	s, circleService, _, actor := fixture(t)
	circle, err := circleService.Create(context.Background(), actor, "http-media")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(s)
	path := "/v1/media/circles/" + circle.ID + "/objects/photo"
	call := func(method, url, body, token string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, url, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/octet-stream")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call("PUT", path+"?epoch=1", "opaque", ""); w.Code != 401 {
		t.Fatalf("unauthenticated: %d", w.Code)
	}
	for _, url := range []string{path, path + "?epoch=1", path + "?epoch=1&epoch=2&operation=http-operation", path + "?epoch=1&operation=http-operation&key=secret"} {
		if w := call("PUT", url, "opaque", mediaToken()); w.Code != 400 {
			t.Fatalf("invalid query %q: %d %s", url, w.Code, w.Body.String())
		}
	}
	for range 2 {
		if w := call("PUT", path+"?epoch=1&operation=http-operation", "opaque", mediaToken()); w.Code != 204 {
			t.Fatalf("put: %d %s", w.Code, w.Body.String())
		}
	}
	if w := call("PUT", path+"?epoch=1&operation=http-operation", "replacement", mediaToken()); w.Code != 409 {
		t.Fatalf("conflict: %d", w.Code)
	}
	w := call("GET", path, "", mediaToken())
	if w.Code != 200 || w.Body.String() != "opaque" || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("download: %d %s %v", w.Code, w.Body.String(), w.Header())
	}
	if w := call("PUT", path+"?epoch=1&operation=http-operation", strings.Repeat("x", 8*1024*1024+1), mediaToken()); w.Code != 413 {
		t.Fatalf("oversized: %d", w.Code)
	}
}

func TestCircleMediaUsesSupabaseStorageAcrossAuthorizedUploadReadAndCancellation(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "supabase-media")
	if err != nil {
		t.Fatal(err)
	}
	objects := sync.Map{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "server-only-key" || r.Header.Get("Authorization") != "Bearer server-only-key" {
			t.Errorf("provider credentials missing from backend request")
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/storage/v1/object/private-media/supabase-circle-object":
			if r.Header.Get("x-upsert") != "false" || r.Header.Get("Content-Type") != "application/octet-stream" {
				t.Errorf("provider upload headers = %v", r.Header)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read provider upload body: %v", err)
				return
			}
			objects.Store("supabase-circle-object", body)
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodGet && r.URL.Path == "/storage/v1/object/private-media/supabase-circle-object":
			body, ok := objects.Load("supabase-circle-object")
			if !ok {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(body.([]byte))
		case r.Method == http.MethodDelete && r.URL.Path == "/storage/v1/object/private-media":
			if r.Header.Get("Content-Type") != "application/json" {
				t.Errorf("provider delete content type = %q", r.Header.Get("Content-Type"))
			}
			var request struct {
				Prefixes []string `json:"prefixes"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Prefixes) != 1 || request.Prefixes[0] != "supabase-circle-object" {
				t.Errorf("provider delete request = %+v, err=%v", request, err)
			}
			objects.Delete("supabase-circle-object")
			w.WriteHeader(http.StatusOK)
		default:
			t.Errorf("unexpected provider request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	store, err := NewSupabaseStore(provider.URL, "server-only-key", "private-media")
	if err != nil {
		t.Fatal(err)
	}
	s.storage = store
	handler := NewHandler(s)
	path := "/v1/media/circles/" + circle.ID + "/objects/supabase-circle-object"
	call := func(method, url, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, url, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+mediaToken())
		if method == http.MethodPut {
			r.Header.Set("Content-Type", "application/octet-stream")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call(http.MethodPut, path+"?epoch=1&operation=supabase-circle-op", "opaque encrypted circle media"); w.Code != http.StatusNoContent {
		t.Fatalf("authenticated Supabase upload: status=%d body=%s", w.Code, w.Body.String())
	}
	if w := call(http.MethodGet, path, ""); w.Code != http.StatusOK || w.Body.String() != "opaque encrypted circle media" {
		t.Fatalf("authorized Supabase read: status=%d body=%q", w.Code, w.Body.String())
	}
	if w := call(http.MethodPost, "/v1/media/circles/"+circle.ID+"/operations/supabase-circle-op/cancel", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"state":"cancelled"`) {
		t.Fatalf("Supabase cancellation: status=%d body=%s", w.Code, w.Body.String())
	}
	if _, err := store.Get(ctx, "supabase-circle-object"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Supabase object remained after cleanup: %v", err)
	}
	if w := call(http.MethodGet, path, ""); w.Code != http.StatusForbidden {
		t.Fatalf("cancelled Supabase media remained readable: status=%d body=%s", w.Code, w.Body.String())
	}
	var state string
	if err := pool.QueryRow(ctx, "SELECT state FROM circle_media_cleanup WHERE object_id='supabase-circle-object'").Scan(&state); err != nil || state != "complete" {
		t.Fatalf("Supabase cleanup state=%q err=%v, want complete", state, err)
	}
}

func TestHTTPPrivateMediaIsRestrictedToAcceptedFriendshipAudience(t *testing.T) {
	s, _, pool, _ := fixture(t)
	ctx := context.Background()
	bobToken := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	eveToken := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("e", 32)))
	for _, account := range []struct{ id, pin, token string }{
		{"bob", "BCDEFGHJ", bobToken},
		{"eve", "CDEFGHJK", eveToken},
	} {
		digest := sha256.Sum256([]byte(account.id))
		if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES($1,$2,$3,1)", account.id, digest[:], account.pin); err != nil {
			t.Fatal(err)
		}
		tokenDigest := sha256.Sum256([]byte(account.token))
		if _, err := pool.Exec(ctx, "INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES($1,$2,$3,1,$4,now(),$5)", "session-"+account.id, account.id, "device-"+account.id, tokenDigest[:], time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, "INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES('alice','bob','friend-private','alice','accepted')"); err != nil {
		t.Fatal(err)
	}
	path := "/v1/media/private/bob/objects/private-photo?audience=friend%3Afriend-private&operation=private-photo-op"
	handler := NewHandler(s)
	call := func(method, body, token string) *httptest.ResponseRecorder {
		t.Helper()
		url := path
		if method == http.MethodGet {
			url = strings.Replace(strings.Split(path, "&operation=")[0], "/private/bob/", "/private/alice/", 1)
		}
		r := httptest.NewRequest(method, url, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/octet-stream")
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call("PUT", "opaque ciphertext", mediaToken()); w.Code != 204 {
		t.Fatalf("accepted-friend upload: status=%d body=%s", w.Code, w.Body.String())
	}
	if w := call("PUT", "opaque ciphertext", mediaToken()); w.Code != 204 {
		t.Fatalf("exact upload retry: status=%d body=%s", w.Code, w.Body.String())
	}
	if w := call("PUT", "changed ciphertext", mediaToken()); w.Code != 409 {
		t.Fatalf("changed ciphertext retry: status=%d body=%s, want 409", w.Code, w.Body.String())
	}
	if w := call("GET", "", bobToken); w.Code != 200 || w.Body.String() != "opaque ciphertext" {
		t.Fatalf("accepted recipient download: status=%d body=%q", w.Code, w.Body.String())
	}
	if _, err := pool.Exec(ctx, "UPDATE friend_links SET request_id='friend-private-next' WHERE low_id='alice' AND high_id='bob'"); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", "", bobToken); w.Code != 403 {
		t.Fatalf("download under replacement friendship audience: status=%d body=%s, want 403", w.Code, w.Body.String())
	}
	if _, err := pool.Exec(ctx, "UPDATE friend_links SET request_id='friend-private' WHERE low_id='alice' AND high_id='bob'"); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", "", bobToken); w.Code != 200 {
		t.Fatalf("original audience download after restoring friendship: status=%d body=%s", w.Code, w.Body.String())
	}
	if w := call("GET", "", eveToken); w.Code != 403 {
		t.Fatalf("outsider download: status=%d body=%s, want 403", w.Code, w.Body.String())
	}
	if _, err := pool.Exec(ctx, "INSERT INTO friend_blocks(actor_id,target_id) VALUES('alice','bob')"); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", "", bobToken); w.Code != 403 {
		t.Fatalf("download after friendship block: status=%d body=%s, want 403", w.Code, w.Body.String())
	}
	cancelPath := "/v1/media/private/bob/operations/private-photo-op/cancel?audience=friend%3Afriend-private"
	cancel := httptest.NewRequest(http.MethodPost, cancelPath, nil)
	cancel.Header.Set("Authorization", "Bearer "+mediaToken())
	cancelResponse := httptest.NewRecorder()
	handler.ServeHTTP(cancelResponse, cancel)
	if cancelResponse.Code != 200 || !strings.Contains(cancelResponse.Body.String(), `"state":"cancelled"`) {
		t.Fatalf("cancel private upload: status=%d body=%s", cancelResponse.Code, cancelResponse.Body.String())
	}
	if w := call("PUT", "opaque ciphertext", mediaToken()); w.Code != 409 {
		t.Fatalf("upload after cancellation: status=%d body=%s, want 409", w.Code, w.Body.String())
	}
	if _, err := pool.Exec(ctx, "DELETE FROM friend_blocks WHERE actor_id='alice' AND target_id='bob'"); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", "", bobToken); w.Code != 403 {
		t.Fatalf("download after cancellation: status=%d body=%s, want 403", w.Code, w.Body.String())
	}
	var cleanupState string
	if err := pool.QueryRow(ctx, "SELECT state FROM private_media_cleanup WHERE object_id='private-photo'").Scan(&cleanupState); err != nil || cleanupState != "complete" {
		t.Fatalf("private cleanup state=%q error=%v, want complete", cleanupState, err)
	}
	committedPath := "/v1/media/private/bob/objects/committed-photo?audience=friend%3Afriend-private&operation=committed-private-op"
	put := httptest.NewRequest(http.MethodPut, committedPath, strings.NewReader("committed ciphertext"))
	put.Header.Set("Content-Type", "application/octet-stream")
	put.Header.Set("Authorization", "Bearer "+mediaToken())
	putResponse := httptest.NewRecorder()
	handler.ServeHTTP(putResponse, put)
	if putResponse.Code != 204 {
		t.Fatalf("committed-operation upload: status=%d body=%s", putResponse.Code, putResponse.Body.String())
	}
	conversation := messages.PrivateConversationID("alice", "bob")
	eventDigest := sha256.Sum256([]byte("committed private event"))
	if _, err := pool.Exec(ctx, "INSERT INTO message_events(id,sender_id,sender_generation,operation_id,conversation,audience,digest,envelope) VALUES('private-event','alice',1,'committed-private-op',$1,'friend:friend-private',$2,'opaque')", conversation, eventDigest[:]); err != nil {
		t.Fatal(err)
	}
	committedCancel := httptest.NewRequest(http.MethodPost, "/v1/media/private/bob/operations/committed-private-op/cancel?audience=friend%3Afriend-private", nil)
	committedCancel.Header.Set("Authorization", "Bearer "+mediaToken())
	committedResponse := httptest.NewRecorder()
	handler.ServeHTTP(committedResponse, committedCancel)
	if committedResponse.Code != 200 || !strings.Contains(committedResponse.Body.String(), `"state":"committed"`) || !strings.Contains(committedResponse.Body.String(), `"eventId":"private-event"`) {
		t.Fatalf("committed operation cancellation: status=%d body=%s", committedResponse.Code, committedResponse.Body.String())
	}
	getCommitted := httptest.NewRequest(http.MethodGet, "/v1/media/private/alice/objects/committed-photo?audience=friend%3Afriend-private", nil)
	getCommitted.Header.Set("Authorization", "Bearer "+bobToken)
	getCommittedResponse := httptest.NewRecorder()
	handler.ServeHTTP(getCommittedResponse, getCommitted)
	if getCommittedResponse.Code != 200 || getCommittedResponse.Body.String() != "committed ciphertext" {
		t.Fatalf("committed media was not preserved: status=%d body=%q", getCommittedResponse.Code, getCommittedResponse.Body.String())
	}
	var committedCleanup int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM private_media_cleanup WHERE object_id='committed-photo'").Scan(&committedCleanup); err != nil || committedCleanup != 0 {
		t.Fatalf("committed cleanup count=%d error=%v, want 0", committedCleanup, err)
	}
}

func TestHTTPMediaCancelRequiresSessionAndReturnsDurableDecision(t *testing.T) {
	s, circleService, _, actor := fixture(t)
	circle, err := circleService.Create(context.Background(), actor, "http-cancel")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(s)
	path := "/v1/media/circles/" + circle.ID + "/operations/http-cancel-op/cancel"
	call := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call(""); w.Code != 401 {
		t.Fatalf("unauthenticated cancel: %d", w.Code)
	}
	if err := s.PutCircle(context.Background(), actor, circle.ID, 1, "http-cancel-object", "http-cancel-op", []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	w := call(mediaToken())
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"state":"cancelled"`) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cancel response: %d %s %v", w.Code, w.Body.String(), w.Header())
	}
	if retry := call(mediaToken()); retry.Code != 200 || !strings.Contains(retry.Body.String(), `"state":"cancelled"`) {
		t.Fatalf("cancel retry: %d %s", retry.Code, retry.Body.String())
	}
}
