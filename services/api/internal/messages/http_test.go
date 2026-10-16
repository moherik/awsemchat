package messages

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"awsemchat/services/api/internal/friends"
)

func TestMessageHTTPUsesSessionAndPreservesSentState(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='alice'", digest[:]); err != nil {
		t.Fatal(err)
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, a[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(NewService(pool, identity))
	call := func(path, body string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		if authenticated {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call("/v1/messages/context", `{"targetId":"bob"}`, false); w.Code != 401 {
		t.Fatalf("anonymous=%d", w.Code)
	}
	w := call("/v1/messages/context", `{"targetId":"bob"}`, true)
	var current ConversationContext
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &current) != nil || len(current.Recipients) != 1 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("context=%d %s", w.Code, w.Body.String())
	}
	payload, _ := json.Marshal(map[string]string{"envelope": contextEnvelope(t, current, "http-one")})
	w = call("/v1/messages", string(payload), true)
	var first Event
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &first) != nil || first.Status != "sent" || first.ID == "" {
		t.Fatalf("send=%d %s", w.Code, w.Body.String())
	}
	w = call("/v1/messages", string(payload), true)
	var retry Event
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &retry) != nil || retry != first {
		t.Fatal("HTTP retry created another event")
	}
	for _, input := range []struct{ path, body string }{{"/v1/messages/context", `{"targetId":"bob","actorId":"carol"}`}, {"/v1/messages/context?targetId=carol", `{"targetId":"bob"}`}, {"/v1/messages", `null`}, {"/v1/messages", `{"envelope":"invalid"} {}`}, {"/v1/messages", `{"envelope":"invalid","plaintext":"secret"}`}} {
		if w := call(input.path, input.body, true); w.Code != 400 {
			t.Fatalf("bad input accepted=%d", w.Code)
		}
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now() WHERE account_id='alice'"); err != nil {
		t.Fatal(err)
	}
	if w := call("/v1/messages", string(payload), true); w.Code != 401 {
		t.Fatalf("revoked send=%d", w.Code)
	}
}

func TestMessageHTTPRedactAcceptsAnOwnedEvent(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("r", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='alice'", digest[:]); err != nil {
		t.Fatal(err)
	}
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	binding, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], contextEnvelope(t, binding, "redact-http"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service)
	request := httptest.NewRequest(http.MethodPost, "/v1/messages/redactions", strings.NewReader(`{"eventId":"`+event.ID+`"}`))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || strings.Contains(response.Body.String(), "ciphertext") || strings.Contains(response.Body.String(), "plaintext") {
		t.Fatalf("redact status=%d body=%s, want 200", response.Code, response.Body.String())
	}
	for _, body := range []string{`null`, `{}`, `{"eventId":"` + event.ID + `","actor":"bob"}`, `{"eventId":"` + event.ID + `","legacy":{}}`, `{"eventId":"missing","eventId":"` + event.ID + `"}`, `{"eventId":"` + event.ID + `"} {}`} {
		request := httptest.NewRequest(http.MethodPost, "/v1/messages/redactions", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid redaction body=%s status=%d", body, response.Code)
		}
	}
	for _, query := range []string{"?limit=1&limit=2", "?actor=alice", "?cursor=" + "not-a-cursor"} {
		request := httptest.NewRequest(http.MethodGet, "/v1/messages/redactions"+query, nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid redaction query=%s status=%d", query, response.Code)
		}
	}
}

func TestInboxHTTPReturnsOnlyRecipientPayloadAndRejectsInvalidPagination(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='bob'", digest[:]); err != nil {
		t.Fatal(err)
	}
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], contextEnvelope(t, current, "inbox-http"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service)
	call := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	w := call("/v1/messages/inbox?limit=1")
	var page InboxPage
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Items[0].ID != event.ID || strings.Contains(w.Body.String(), "recipients") || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("inbox=%d %s", w.Code, w.Body.String())
	}
	for _, query := range []string{"?limit=1&limit=2", "?limit=26", "?limit=bad", "?actorId=alice", "?cursor=foreign"} {
		if w := call("/v1/messages/inbox" + query); w.Code != 400 {
			t.Fatalf("invalid query=%d", w.Code)
		}
	}
}

func TestHistoryHTTPAllowsInitialEmptyCursorWithoutAcknowledging(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("h", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='bob'", digest[:]); err != nil {
		t.Fatal(err)
	}
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], contextEnvelope(t, current, "history-http"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service)
	request := httptest.NewRequest(http.MethodGet, "/v1/messages/history?conversation="+current.Conversation+"&audience="+current.Audience+"&cursor=&limit=25", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var page InboxPage
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Items[0].ID != event.ID {
		t.Fatalf("history=%d %s", response.Code, response.Body.String())
	}
	status, err := service.Status(ctx, a[0], event.ID)
	if err != nil || status.Status != "sent" {
		t.Fatalf("history changed delivery status=%+v err=%v", status, err)
	}
}

func TestReceiptHTTPUsesRecipientSessionAndStrictBody(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='bob'", digest[:]); err != nil {
		t.Fatal(err)
	}
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	binding, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], contextEnvelope(t, binding, "receipt-http"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service)
	call := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/v1/messages/acknowledgements", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	payload := `{"eventId":"` + event.ID + `"}`
	if w := call(payload); w.Code != 200 || w.Body.String() != "null\n" {
		t.Fatalf("ack HTTP=%d %s, want 200 null", w.Code, w.Body.String())
	}
	for _, body := range []string{`null`, `{}`, `{"eventId":"` + event.ID + `","recipientId":"alice"}`, payload + ` {}`} {
		if w := call(body); w.Code != 400 {
			t.Fatalf("invalid ack body=%s status=%d, want 400", body, w.Code)
		}
	}
}

func TestStatusHTTPIsSenderOwnedAndDeliveryOnly(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	tokens := []string{base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("a", 32))), base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))}
	for i, token := range tokens {
		digest := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id=$2", digest[:], a[i].AccountID); err != nil {
			t.Fatal(err)
		}
	}
	accept(t, friends.NewService(pool, identity), a[0], a[1], "BCDEFGHJ")
	service := NewService(pool, identity)
	binding, err := service.Context(ctx, a[0], ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := service.Send(ctx, a[0], contextEnvelope(t, binding, "status-http"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service)
	call := func(token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/v1/messages/status", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	body := `{"eventId":"` + event.ID + `"}`
	w := call(tokens[0], body)
	var status Event
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &status) != nil || status != event {
		t.Fatalf("Status HTTP=%d %s, want sent event", w.Code, w.Body.String())
	}
	if err = service.Acknowledge(ctx, a[1], event.ID); err != nil {
		t.Fatal(err)
	}
	w = call(tokens[0], body)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &status) != nil || status.Status != "delivered" {
		t.Fatalf("Status HTTP=%d %s, want delivered", w.Code, w.Body.String())
	}
	if w = call(tokens[1], body); w.Code != 403 {
		t.Fatalf("recipient status=%d, want 403", w.Code)
	}
	for _, invalid := range []string{`null`, `{}`, body + ` {}`, `{"eventId":"` + event.ID + `","senderId":"alice"}`} {
		if w = call(tokens[0], invalid); w.Code != 400 {
			t.Fatalf("invalid status body=%s code=%d, want 400", invalid, w.Code)
		}
	}
}
