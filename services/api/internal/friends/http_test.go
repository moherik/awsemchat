package friends

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func tokenFor(account string) string {
	digest := sha256.Sum256([]byte(account))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
func TestSocialHTTPAuthenticatesActorAndCompletesFriendship(t *testing.T) {
	s, _, _ := fixture(t)
	handler := NewHandler(s)
	call := func(actor, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if actor != "" {
			req.Header.Set("Authorization", "Bearer "+tokenFor(actor))
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	if w := call("", http.MethodGet, "/v1/friends", ""); w.Code != 401 {
		t.Fatalf("anonymous list=%d", w.Code)
	}
	w := call("alice", http.MethodPost, "/v1/friends/requests", `{"pin":"BCDEFGHJ"}`)
	if w.Code != 200 {
		t.Fatalf("request=%d %s", w.Code, w.Body.String())
	}
	var request Request
	if err := json.Unmarshal(w.Body.Bytes(), &request); err != nil || request.ID == "" {
		t.Fatal("invalid request DTO")
	}
	path := "/v1/friends/requests/" + request.ID + "/response"
	if w := call("alice", http.MethodPost, path, `{"accept":true}`); w.Code != 403 {
		t.Fatalf("sender accepted=%d", w.Code)
	}
	if w := call("bob", http.MethodPost, path, `{"accept":true}`); w.Code != 204 {
		t.Fatalf("recipient acceptance=%d %s", w.Code, w.Body.String())
	}
	w = call("alice", http.MethodGet, "/v1/friends?kind=accepted&limit=1", "")
	var page Page
	if w.Code != 200 {
		t.Fatalf("friend list=%d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || len(page.Items) != 1 || page.Items[0].AccountID != "bob" {
		t.Fatalf("friend list=%s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "phone") || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("unsafe public social response")
	}
	if w := call("bob", http.MethodPut, "/v1/friends/blocks/alice", `{"blocked":true}`); w.Code != 204 {
		t.Fatalf("block=%d", w.Code)
	}
	for _, tc := range []struct{ method, path, body string }{{"POST", "/v1/friends/requests", `{"pin":"BCDEFGHJ","actorId":"bob"}`}, {"POST", path, `{}`}, {"GET", "/v1/friends?kind=accepted&kind=incoming", ""}, {"GET", "/v1/friends?limit=invalid", ""}, {"POST", "/v1/friends/requests", `{"pin":"BCDEFGHJ"} {}`}} {
		if w := call("alice", tc.method, tc.path, tc.body); w.Code != 400 {
			t.Errorf("bad input accepted: %s status=%d", tc.path, w.Code)
		}
	}
}

func TestSocialHTTPAcceptsExplicitFalseAndRejectsRevokedReadAndWrite(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	handler := NewHandler(s)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+tokenFor("bob"))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	request, err := s.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if w := call("POST", "/v1/friends/requests/"+request.ID+"/response", `{"accept":false}`); w.Code != 204 {
		t.Fatalf("explicit decline=%d", w.Code)
	}
	if err := s.Block(ctx, a[1], "alice", true); err != nil {
		t.Fatal(err)
	}
	if w := call("PUT", "/v1/friends/blocks/alice", `{"blocked":false}`); w.Code != 204 {
		t.Fatalf("explicit unblock=%d", w.Code)
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", a[1].SessionID); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", "/v1/friends", ""); w.Code != 401 {
		t.Fatalf("revoked read=%d", w.Code)
	}
	if w := call("PUT", "/v1/friends/blocks/alice", `{"blocked":true}`); w.Code != 401 {
		t.Fatalf("revoked write=%d", w.Code)
	}
}
