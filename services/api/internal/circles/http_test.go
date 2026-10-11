package circles

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func tokenFor(id string) string {
	digest := sha256.Sum256([]byte(id))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
func sessionDigest(id string) []byte { digest := sha256.Sum256([]byte(tokenFor(id))); return digest[:] }
func TestCircleHTTPAuthenticatesAndEnforcesMembershipActions(t *testing.T) {
	s, pool, _ := fixture(t)
	addActor(t, pool, "bob", true)
	h := NewHandler(s)
	call := func(actor, method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if actor != "" {
			r.Header.Set("Authorization", "Bearer "+tokenFor(actor))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := call("", "POST", "/v1/circles", `{"operationId":"create-1"}`); w.Code != 401 {
		t.Fatalf("anonymous=%d", w.Code)
	}
	w := call("alice", "POST", "/v1/circles", `{"operationId":"create-1"}`)
	if w.Code != 200 {
		t.Fatalf("create=%d %s", w.Code, w.Body.String())
	}
	var c struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil || c.ID == "" {
		t.Fatalf("Circle DTO=%s", w.Body.String())
	}
	base := "/v1/circles/" + c.ID
	w = call("alice", "POST", base+"/invitations", `{"accountId":"bob"}`)
	if w.Code != 200 {
		t.Fatalf("invite=%d %s", w.Code, w.Body.String())
	}
	var i struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &i); err != nil || i.ID == "" {
		t.Fatal("missing invite ID")
	}
	response := "/v1/circles/invitations/" + i.ID + "/response"
	if w := call("alice", "POST", response, `{"accept":true}`); w.Code != 403 {
		t.Fatalf("sender consent=%d", w.Code)
	}
	if w := call("bob", "POST", response, `{"accept":true}`); w.Code != 200 {
		t.Fatalf("accept=%d %s", w.Code, w.Body.String())
	}
	if w := call("alice", "POST", base+"/leave", `{}`); w.Code != 409 || !strings.Contains(w.Body.String(), "ADMIN_HANDOFF_REQUIRED") {
		t.Fatalf("handoff=%d %s", w.Code, w.Body.String())
	}
	if w := call("bob", "POST", base+"/members/alice/remove", `{}`); w.Code != 403 {
		t.Fatalf("nonadmin removal=%d", w.Code)
	}
	if w := call("alice", "POST", base+"/members/bob/remove", `{}`); w.Code != 204 {
		t.Fatalf("remove=%d", w.Code)
	}
	for _, tc := range []struct{ path, body string }{{"/v1/circles", `{"operationId":"new","actorId":"bob"}`}, {response, `{}`}, {base + "/leave?actor=bob", `{}`}, {base + "/leave", `{} {}`}} {
		if w := call("alice", "POST", tc.path, tc.body); w.Code != 400 {
			t.Errorf("malformed=%d path=%s", w.Code, tc.path)
		}
	}
	if _, err := pool.Exec(context.Background(), "UPDATE auth_sessions SET revoked_at=now() WHERE account_id='alice'"); err != nil {
		t.Fatal(err)
	}
	if w := call("alice", "POST", base+"/leave", `{}`); w.Code != 401 {
		t.Fatalf("revoked=%d", w.Code)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("unsafe cache policy")
	}
}

func TestCircleHTTPHandoffAllowsAdminToLeave(t *testing.T) {
	s, pool, a := fixture(t)
	ctx := context.Background()
	bob := addActor(t, pool, "bob", true)
	c, err := s.Create(ctx, a, "create-1")
	if err != nil {
		t.Fatal(err)
	}
	i, err := s.Invite(ctx, a, c.ID, bob.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Respond(ctx, bob, i.ID, true); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(s)
	r := httptest.NewRequest("POST", "/v1/circles/"+c.ID+"/handoff", strings.NewReader(`{"accountId":"bob"}`))
	r.Header.Set("Authorization", "Bearer "+tokenFor("alice"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 204 {
		t.Fatalf("handoff route=%d %s", w.Code, w.Body.String())
	}
	if err := s.Leave(ctx, a, c.ID); err != nil {
		t.Fatal(err)
	}
}
