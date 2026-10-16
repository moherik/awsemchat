package messages

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
)

func TestCollectionManifestHTTPIsBoundedCurrentAndRevisionFenced(t *testing.T) {
	pool, identity, a := messageDatabase(t)
	ctx := context.Background()
	token := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	digest := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, "UPDATE auth_sessions SET token_digest=$1 WHERE account_id='alice'", digest[:]); err != nil {
		t.Fatal(err)
	}
	groups := circles.NewService(pool, identity)
	circle, err := groups.Create(ctx, a[0], "manifest-circle")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, identity)
	current, err := service.Context(ctx, a[0], ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	for i, item := range []string{"a-item", "b-item"} {
		if _, err = service.Send(ctx, a[0], collectionEnvelope(t, current, "add-"+item, "add", "sticker", item, int64(i+1))); err != nil {
			t.Fatal(err)
		}
	}
	handler := NewHandler(service)
	call := func(body map[string]any, authenticated bool) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", "/v1/messages/collections/manifest", strings.NewReader(string(raw)))
		if authenticated {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	body := map[string]any{"circleId": circle.ID, "epoch": 1, "revision": 2, "cursor": "", "limit": 1}
	result := call(body, true)
	if result.Code != 200 {
		t.Fatalf("manifest=%d %s", result.Code, result.Body.String())
	}
	var first map[string]any
	if err = json.Unmarshal(result.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	want := `{"circleId":"` + circle.ID + `","epoch":1,"revision":2,"items":[{"id":"a-item","kind":"sticker"}],"cursor":"a-item","more":true}`
	var expected map[string]any
	json.Unmarshal([]byte(want), &expected)
	got, _ := json.Marshal(first)
	wantRaw, _ := json.Marshal(expected)
	if string(got) != string(wantRaw) {
		t.Fatalf("manifest got=%s want=%s", got, wantRaw)
	}
	body["cursor"] = "a-item"
	result = call(body, true)
	if result.Code != 200 {
		t.Fatalf("next page=%d", result.Code)
	}
	var second struct {
		Items []struct {
			ID string `json:"id"`
		}
		More bool `json:"more"`
	}
	if err = json.Unmarshal(result.Body.Bytes(), &second); err != nil || len(second.Items) != 1 || second.Items[0].ID != "b-item" || second.More {
		t.Fatalf("next page=%s err=%v", result.Body.String(), err)
	}
	if result = call(body, false); result.Code != 401 {
		t.Fatalf("anonymous manifest=%d", result.Code)
	}
	body["limit"] = 51
	if result = call(body, true); result.Code != 400 {
		t.Fatalf("unbounded manifest=%d", result.Code)
	}
	body["limit"] = 1
	if _, err = service.Send(ctx, a[0], collectionEnvelope(t, current, "remove-a", "remove", "sticker", "a-item", 3)); err != nil {
		t.Fatal(err)
	}
	if result = call(body, true); result.Code != 409 {
		t.Fatalf("changed revision continued old page=%d", result.Code)
	}
	body["revision"] = 3
	body["cursor"] = ""
	result = call(body, true)
	if result.Code != 200 || strings.Contains(result.Body.String(), "a-item") {
		t.Fatalf("deleted item exposed: %d %s", result.Code, result.Body.String())
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, a[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err = social.Respond(ctx, a[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	invite, err := groups.Invite(ctx, a[0], circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = groups.Respond(ctx, a[1], invite.ID, true); err != nil {
		t.Fatal(err)
	}
	if result = call(body, true); result.Code != 409 {
		t.Fatalf("membership epoch change continued old manifest=%d", result.Code)
	}
	body["epoch"] = 2
	body["unknown"] = "private"
	if result = call(body, true); result.Code != 400 {
		t.Fatalf("unknown manifest field=%d", result.Code)
	}
	delete(body, "unknown")
	if err = groups.Handoff(ctx, a[0], circle.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	if err = groups.Leave(ctx, a[0], circle.ID); err != nil {
		t.Fatal(err)
	}
	if result = call(body, true); result.Code != 403 {
		t.Fatalf("former member manifest=%d", result.Code)
	}
}
