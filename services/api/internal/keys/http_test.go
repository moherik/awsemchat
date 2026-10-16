package keys

import (
	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/friends"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRegistrationHTTPUsesSessionAndRejectsMalformedOrRevokedRequests(t *testing.T) {
	pool, identity, actor := keyDatabase(t)
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("C", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(context.Background(), "UPDATE auth_sessions SET token_digest=$1", digest[:]); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(NewService(pool, identity))
	issued := time.Now().Unix()
	batch := registration(t, actor, []Bundle{signed(t, func(b *Bundle) { b.IssuedAt = issued; b.ExpiresAt = issued + 604800 })})
	raw, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	call := func(path, body string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		if authenticated {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call("/v1/keys/publications", string(raw), false); w.Code != 401 {
		t.Fatalf("anonymous=%d", w.Code)
	}
	if w := call("/v1/keys/publications", string(raw), true); w.Code != 204 || w.Body.Len() != 0 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("publication=%d %s", w.Code, w.Body.String())
	}
	for _, body := range []string{`{"accountId":"other","bundles":[],"proof":""}`, string(raw) + ` {}`, `null`, strings.Repeat(" ", 32769) + string(raw)} {
		if w := call("/v1/keys/publications", body, true); w.Code != 400 {
			t.Fatalf("malformed=%d", w.Code)
		}
	}
	if w := call("/v1/keys/publications?actor=other", string(raw), true); w.Code != 400 {
		t.Fatalf("query=%d", w.Code)
	}
	if _, err := pool.Exec(context.Background(), "UPDATE auth_sessions SET revoked_at=now()"); err != nil {
		t.Fatal(err)
	}
	if w := call("/v1/keys/publications", string(raw), true); w.Code != 401 {
		t.Fatalf("revoked=%d", w.Code)
	}
}

func TestAllocationHTTPEnforcesConsentAndReturnsOneSignedBundle(t *testing.T) {
	pool, identity, actor := keyDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("C", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1", digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',decode(repeat('44',32),'hex'),'BCDEFGHJ',1); INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-bob','bob','device-bob',1,decode(repeat('45',32),'hex'),now(),now()+interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	peer := auth.Principal{AccountID: "bob", SessionID: "session-bob", DeviceID: "device-bob", Generation: 1}
	service := NewService(pool, identity)
	issued := time.Now().Unix()
	bundle := signed(t, func(b *Bundle) { b.IssuedAt = issued; b.ExpiresAt = issued + 604800 })
	if err := service.Publish(ctx, peer, registration(t, peer, []Bundle{bundle}), time.Now()); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service)
	call := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/v1/keys/allocations", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	body := `{"operationId":"initial","targetId":"bob"}`
	if w := call(body); w.Code != 403 {
		t.Fatalf("no consent=%d %s", w.Code, w.Body.String())
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actor, "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, peer, request.ID, true); err != nil {
		t.Fatal(err)
	}
	w := call(body)
	var allocation Allocation
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &allocation) != nil || allocation.Generation != 1 || allocation.Bundle.KeyID != bundle.KeyID || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("allocation=%d %s", w.Code, w.Body.String())
	}
	if w := call(`{"operationId":"another","targetId":"bob"}`); w.Code != 409 || !strings.Contains(w.Body.String(), "KEYS_EXHAUSTED") {
		t.Fatalf("exhausted=%d %s", w.Code, w.Body.String())
	}
	if w := call(`{"operationId":"initial","targetId":"bob","actorId":"bob"}`); w.Code != 400 {
		t.Fatalf("actor injection=%d", w.Code)
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now() WHERE account_id='alice'"); err != nil {
		t.Fatal(err)
	}
	if w := call(body); w.Code != 401 {
		t.Fatalf("revoked=%d", w.Code)
	}
}
