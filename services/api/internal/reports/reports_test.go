package reports

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/friends"
	"awsemchat/services/api/internal/messages"
	"awsemchat/services/api/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func reportDatabase(t *testing.T) (*Service, *pgxpool.Pool, []auth.Principal, string) {
	t.Helper()
	url := os.Getenv("AWSEM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("real PostgreSQL fixture required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "reports_test_" + strings.ReplaceAll(time.Now().Format("150405.000000000"), ".", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	identity, err := auth.NewService(pool, auth.NewDevelopmentSMS(time.Now), auth.Config{Pepper: []byte(strings.Repeat("p", 32))})
	if err != nil {
		t.Fatal(err)
	}
	actors := make([]auth.Principal, 3)
	for i, id := range []string{"alice", "bob", "carol"} {
		phone := sha256.Sum256([]byte("phone-" + id))
		token := sha256.Sum256([]byte("token-" + id))
		expires := time.Now().Add(time.Hour)
		if _, err := pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES($1,$2,$3,1)`, id, phone[:], []string{"ABCDEFGH", "BCDEFGHJ", "CDEFGHJK"}[i]); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES($1,$2,$3,1,$4,now(),$5)`, "session-"+id, id, "device-"+id, token[:], expires); err != nil {
			t.Fatal(err)
		}
		actors[i] = auth.Principal{SessionID: "session-" + id, AccountID: id, DeviceID: "device-" + id, Generation: 1, ExpiresAt: expires}
	}
	social := friends.NewService(pool, identity)
	request, err := social.Request(ctx, actors[0], "BCDEFGHJ")
	if err != nil {
		t.Fatal(err)
	}
	if err := social.Respond(ctx, actors[1], request.ID, true); err != nil {
		t.Fatal(err)
	}
	conversation := messages.PrivateConversationID("alice", "bob")
	digest := sha256.Sum256([]byte("message"))
	if _, err := pool.Exec(ctx, `INSERT INTO message_events(id,sender_id,sender_generation,operation_id,conversation,audience,digest,envelope) VALUES('event-1','bob',1,'message-op',$1,$2,$3,'opaque')`, conversation, "friend:"+request.ID, digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO message_deliveries(event_id,recipient_id,recipient_generation,public_keys,ciphertext) VALUES('event-1','alice',1,'[]','[]')`); err != nil {
		t.Fatal(err)
	}
	return NewService(pool, identity), pool, actors, conversation
}

func TestValidateInput(t *testing.T) {
	valid := Input{OperationID: "operation-1", Conversation: "private:" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SubjectID: "friend-1", Reason: "harassment", Details: "Please review", Selected: []SelectedMessage{{EventID: "event-1", Text: "Stop contacting me"}}}
	if err := ValidateInput(valid); err != nil {
		t.Fatalf("ValidateInput(valid) = %v, want nil", err)
	}
}

func TestCreateRejectsConversationSpoofBeforeDatabaseAccess(t *testing.T) {
	service := NewService(nil, nil)
	input := Input{OperationID: "operation-1", Conversation: "private:" + strings.Repeat("a", 64), SubjectID: "friend-1", Reason: "spam"}
	_, err := service.Create(context.Background(), auth.Principal{AccountID: "attacker"}, input)
	if !errors.Is(err, ErrDenied) {
		t.Errorf("Create(spoofed conversation) = %v, want ErrDenied", err)
	}
}

func TestReportHandlerRequiresAuthentication(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/reports", nil)
	NewHandler(NewService(nil, nil)).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Errorf("POST /v1/reports without auth = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestValidateInputRejectsUnboundedOrAmbiguousReports(t *testing.T) {
	base := Input{OperationID: "operation-1", Conversation: "private:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SubjectID: "friend-1", Reason: "spam", Selected: []SelectedMessage{{EventID: "event-1", Text: "message"}}}
	tests := []struct {
		name   string
		change func(*Input)
	}{
		{"unknown reason", func(v *Input) { v.Reason = "other" }},
		{"oversized details", func(v *Input) { v.Details = string(make([]byte, 1001)) }},
		{"duplicate event", func(v *Input) { v.Selected = append(v.Selected, v.Selected[0]) }},
		{"blank selected content", func(v *Input) { v.Selected[0].Text = " \n " }},
		{"too many messages", func(v *Input) { v.Selected = make([]SelectedMessage, 21) }},
		{"non-private conversation", func(v *Input) { v.Conversation = "circle-1" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			input := base
			input.Selected = append([]SelectedMessage(nil), base.Selected...)
			tt.change(&input)
			if err := ValidateInput(input); err == nil {
				t.Errorf("ValidateInput(%s) = nil, want invalid input", tt.name)
			}
		})
	}
}

func TestCreateDisclosesOnlyAccessibleSelectedContentAndRetriesExactly(t *testing.T) {
	service, pool, actors, conversation := reportDatabase(t)
	ctx := context.Background()
	input := Input{OperationID: "report-op", Conversation: conversation, SubjectID: "bob", Reason: "harassment", Details: "Please review this", Selected: []SelectedMessage{{EventID: "event-1", Text: "The reporter's explicit excerpt"}}}
	first, err := service.Create(ctx, actors[0], input)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || time.Until(first.ExpiresAt) < 89*24*time.Hour || time.Until(first.ExpiresAt) > 91*24*time.Hour {
		t.Fatalf("unexpected report=%+v", first)
	}
	retry, err := service.Create(ctx, actors[0], input)
	if err != nil || retry != first {
		t.Fatalf("exact retry=%+v, err=%v; want %+v", retry, err, first)
	}
	changed := input
	changed.Details = "different content"
	if _, err := service.Create(ctx, actors[0], changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed retry=%v, want ErrConflict", err)
	}
	unavailable := input
	unavailable.OperationID = "report-unavailable"
	unavailable.Selected = []SelectedMessage{{EventID: "not-delivered", Text: "unavailable"}}
	if _, err := service.Create(ctx, actors[0], unavailable); !errors.Is(err, ErrDenied) {
		t.Fatalf("unavailable selection=%v, want ErrDenied", err)
	}
	var count int
	var selected []byte
	var expires time.Time
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_reports WHERE reporter_id='alice'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT selected_content,expires_at FROM user_reports WHERE reporter_id='alice'`).Scan(&selected, &expires); err != nil {
		t.Fatal(err)
	}
	if count != 1 || !strings.Contains(string(selected), "The reporter's explicit excerpt") {
		t.Fatalf("stored reports=%d selected=%s", count, selected)
	}
	if expires.Before(time.Now().Add(89 * 24 * time.Hour)) {
		t.Fatalf("expiry=%s; report expires too soon", expires)
	}
}
