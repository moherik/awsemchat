package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type deliveredSMS struct {
	mu          sync.Mutex
	phone, code string
	fail        bool
	calls       int
}

func (s *deliveredSMS) SendCode(ctx context.Context, phone, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.phone, s.code = phone, code
	if s.fail {
		return errors.New("synthetic delivery failure")
	}
	return nil
}
func fixture(t *testing.T) (*Service, *deliveredSMS, *pgxpool.Pool, *time.Time) {
	t.Helper()
	url := os.Getenv("AWSEM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("AWSEM_TEST_DATABASE_URL required for real PostgreSQL tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		t.Fatal(err)
	}
	schema := "auth_test_" + hex.EncodeToString(id)
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
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	migration, err := os.ReadFile("../../migrations/001_identity.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC)
	sms := &deliveredSMS{}
	pepper := make([]byte, 32)
	if _, err := rand.Read(pepper); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(pool, sms, Config{Pepper: pepper, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	return service, sms, pool, &now
}
func TestMissingAuthenticationDependenciesFailClosed(t *testing.T) {
	t.Parallel()
	if _, err := NewService(nil, nil, Config{}); !errors.Is(err, ErrUnavailable) {
		t.Errorf("NewService(missing dependencies) = %v, want ErrUnavailable", err)
	}
}
func TestStartDeliversAndPersistsOnlyDigests(t *testing.T) {
	t.Parallel()
	service, sms, pool, _ := fixture(t)
	input := StartInput{Phone: "+6281234567890", DeviceID: "phone-one", OperationID: "operation-one", Network: "127.0.0.1"}
	challenge, err := service.Start(context.Background(), input)
	if err != nil {
		t.Fatalf("Start(valid phone) = %v, want delivered challenge", err)
	}
	if challenge.ID == "" || len(sms.code) != 6 || sms.phone != input.Phone {
		t.Fatalf("Start(valid phone) = %#v/code length%d, want challenge and SMS", challenge, len(sms.code))
	}
	var digest []byte
	var status string
	if err := pool.QueryRow(context.Background(), "SELECT code_digest,status FROM auth_challenges WHERE id=$1", challenge.ID).Scan(&digest, &status); err != nil {
		t.Fatal(err)
	}
	if len(digest) != 32 || status != "ready" {
		t.Errorf("Stored challenge = digest%d/status%q, want32/ready", len(digest), status)
	}
	repeated, err := service.Start(context.Background(), input)
	if err != nil || repeated.ID != challenge.ID {
		t.Errorf("Start(same operation) = %#v/%v, want same challenge", repeated, err)
	}
}

func TestInvalidChallengeInputNeverSendsSMS(t *testing.T) {
	t.Parallel()
	service, sms, _, _ := fixture(t)
	valid := StartInput{Phone: "+6281234567890", DeviceID: "device", OperationID: "request", Network: "127.0.0.1"}
	tests := []struct {
		name   string
		change func(*StartInput)
	}{
		{"phone without country prefix", func(i *StartInput) { i.Phone = "081234567890" }},
		{"oversized phone", func(i *StartInput) { i.Phone = "+1234567890123456" }},
		{"missing device", func(i *StartInput) { i.DeviceID = "" }},
		{"invalid operation", func(i *StartInput) { i.OperationID = "bad\noperation" }},
		{"invalid network address", func(i *StartInput) { i.Network = "arbitrary-proxy-header" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := valid
			tt.change(&input)
			if _, err := service.Start(context.Background(), input); !errors.Is(err, ErrInvalidInput) {
				t.Errorf("Start(%s)=%v,want ErrInvalidInput", tt.name, err)
			}
		})
	}
	if sms.calls != 0 {
		t.Errorf("Invalid inputs sent %d SMS,want0", sms.calls)
	}
}
func TestPhoneCooldownAndNetworkLimit(t *testing.T) {
	t.Parallel()
	service, sms, _, now := fixture(t)
	input := StartInput{Phone: "+6281234567890", DeviceID: "device", OperationID: "one", Network: "127.0.0.1"}
	if _, err := service.Start(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	input.OperationID = "two"
	if _, err := service.Start(context.Background(), input); !errors.Is(err, ErrRateLimited) {
		t.Errorf("Start(second phone request)=%v,want ErrRateLimited", err)
	}
	*now = now.Add(60 * time.Second)
	if _, err := service.Start(context.Background(), input); err != nil {
		t.Fatalf("Start(after cooldown)=%v,want success", err)
	}
	for i := 0; i < 8; i++ {
		input.Phone = fmt.Sprintf("+6281000000%02d", i)
		input.OperationID = fmt.Sprintf("different-%d", i)
		if _, err := service.Start(context.Background(), input); err != nil {
			t.Fatal(err)
		}
	}
	input.Phone = "+6289999999999"
	input.OperationID = "eleventh"
	if _, err := service.Start(context.Background(), input); !errors.Is(err, ErrRateLimited) {
		t.Errorf("Start(network request11)=%v,want ErrRateLimited", err)
	}
	if sms.calls != 10 {
		t.Errorf("Network SMS calls=%d,want10", sms.calls)
	}
}
func TestConcurrentOperationSendsOneSMS(t *testing.T) {
	t.Parallel()
	service, sms, _, _ := fixture(t)
	input := StartInput{Phone: "+6281234567890", DeviceID: "device", OperationID: "same-operation", Network: "127.0.0.1"}
	errs := make(chan error, 20)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := service.Start(context.Background(), input); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil && !errors.Is(err, ErrChallengePending) {
			t.Errorf("Concurrent Start=%v,want ready or pending", err)
		}
	}
	if sms.calls != 1 {
		t.Errorf("Concurrent SMS calls=%d,want1", sms.calls)
	}
}

func challengeFor(t *testing.T, s *Service, sms *deliveredSMS, device, operation string) (Challenge, string) {
	t.Helper()
	challenge, err := s.Start(context.Background(), StartInput{Phone: "+6281234567890", DeviceID: device, OperationID: operation, Network: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	return challenge, sms.code
}
func TestVerificationReplacesPreviousPhoneAtomically(t *testing.T) {
	t.Parallel()
	service, sms, _, now := fixture(t)
	first, code := challengeFor(t, service, sms, "device-one", "first")
	session, err := service.Verify(context.Background(), VerifyInput{first.ID, code, "device-one"})
	if err != nil {
		t.Fatalf("Verify(correct code)=%v,want session", err)
	}
	if session.Account.ID == "" || len(session.Account.PIN) != 8 || session.Generation != 1 {
		t.Fatalf("Verify(created account) returned invalid identity/generation")
	}
	principal, err := service.RequireSession(context.Background(), session.Token)
	if err != nil || principal.AccountID != session.Account.ID {
		t.Fatalf("RequireSession(first token)=%v,want same account", err)
	}
	*now = now.Add(time.Minute)
	second, code := challengeFor(t, service, sms, "device-two", "second")
	replacement, err := service.Verify(context.Background(), VerifyInput{second.ID, code, "device-two"})
	if err != nil {
		t.Fatal(err)
	}
	if replacement.Account != session.Account || replacement.Generation != 2 {
		t.Errorf("Replacement identity/generation mismatch")
	}
	if _, err := service.RequireSession(context.Background(), session.Token); !errors.Is(err, ErrSessionRevoked) {
		t.Errorf("RequireSession(old token)=%v,want revoked", err)
	}
	if p, err := service.RequireSession(context.Background(), replacement.Token); err != nil || p.DeviceID != "device-two" {
		t.Errorf("RequireSession(replacement)=%v,want device-two", err)
	}
	body, err := json.Marshal(replacement.Account)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "phone") || strings.Contains(string(body), "6281234567890") {
		t.Error("Public account leaks phone")
	}
}
func TestCodeReplayExpiryAndAttemptLimit(t *testing.T) {
	tests := []string{"replay", "expiry", "attempts", "wrong-device"}
	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			service, sms, _, now := fixture(t)
			challenge, code := challengeFor(t, service, sms, "device", "one")
			input := VerifyInput{challenge.ID, code, "device"}
			switch name {
			case "replay":
				if _, err := service.Verify(context.Background(), input); err != nil {
					t.Fatal(err)
				}
				if _, err := service.Verify(context.Background(), input); !errors.Is(err, ErrConsumed) {
					t.Errorf("Verify(replay)=%v,want consumed", err)
				}
			case "expiry":
				*now = now.Add(5 * time.Minute)
				if _, err := service.Verify(context.Background(), input); !errors.Is(err, ErrExpired) {
					t.Errorf("Verify(expired)=%v,want expired", err)
				}
			case "attempts":
				wrong := input
				wrong.Code = "000000"
				if code == wrong.Code {
					wrong.Code = "111111"
				}
				for i := 0; i < 5; i++ {
					if _, err := service.Verify(context.Background(), wrong); !errors.Is(err, ErrInvalidCode) {
						t.Errorf("Verify(wrong attempt%d)=%v,want invalid", i, err)
					}
				}
				if _, err := service.Verify(context.Background(), input); !errors.Is(err, ErrInvalidCode) {
					t.Errorf("Verify(after attempts)=%v,want invalid", err)
				}
			case "wrong-device":
				wrong := input
				wrong.DeviceID = "other"
				if _, err := service.Verify(context.Background(), wrong); !errors.Is(err, ErrInvalidCode) {
					t.Errorf("Verify(wrong device)=%v,want invalid", err)
				}
				if _, err := service.Verify(context.Background(), input); err != nil {
					t.Errorf("Verify(original device)=%v,want success", err)
				}
			}
		})
	}
}
func TestFailedSMSCannotAuthenticate(t *testing.T) {
	t.Parallel()
	service, sms, pool, _ := fixture(t)
	sms.fail = true
	_, err := service.Start(context.Background(), StartInput{Phone: "+6281234567890", DeviceID: "device", OperationID: "failed", Network: "127.0.0.1"})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Start(failed SMS)=%v,want unavailable", err)
	}
	var id string
	if err := pool.QueryRow(context.Background(), "SELECT id FROM auth_challenges").Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Verify(context.Background(), VerifyInput{id, sms.code, "device"}); !errors.Is(err, ErrInvalidCode) {
		t.Errorf("Verify(delivery failed)=%v,want invalid", err)
	}
}
func TestConcurrentCodeVerificationCreatesOneSession(t *testing.T) {
	t.Parallel()
	service, sms, pool, _ := fixture(t)
	challenge, code := challengeFor(t, service, sms, "device", "one")
	errs := make(chan error, 20)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.Verify(context.Background(), VerifyInput{challenge.ID, code, "device"})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	successes := 0
	for err := range errs {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrConsumed) {
			t.Errorf("Concurrent Verify=%v,want consumed", err)
		}
	}
	if successes != 1 {
		t.Errorf("Concurrent Verify successes=%d,want1", successes)
	}
	if successes == 1 {
		var count int
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM auth_sessions").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Errorf("Session count=%d,want1", count)
		}
	}
}

func TestExpiredTokenAndStoredDigests(t *testing.T) {
	t.Parallel()
	service, sms, pool, now := fixture(t)
	challenge, code := challengeFor(t, service, sms, "device", "one")
	session, err := service.Verify(context.Background(), VerifyInput{ChallengeID: challenge.ID, Code: code, DeviceID: "device"})
	if err != nil {
		t.Fatal(err)
	}
	var digest []byte
	if err := pool.QueryRow(context.Background(), "SELECT token_digest FROM auth_sessions").Scan(&digest); err != nil {
		t.Fatal(err)
	}
	if len(digest) != 32 || string(digest) == session.Token {
		t.Error("Database stores invalid token digest")
	}
	*now = session.ExpiresAt
	if _, err := service.RequireSession(context.Background(), session.Token); !errors.Is(err, ErrSessionRevoked) {
		t.Errorf("Expired token=%v,want revoked", err)
	}
	if _, err := service.RequireSession(context.Background(), "not-a-token"); !errors.Is(err, ErrSessionRevoked) {
		t.Errorf("Malformed token=%v,want revoked", err)
	}
}
func TestLogoutRevokesCurrentSession(t *testing.T) {
	t.Parallel()
	service, sms, _, _ := fixture(t)
	challenge, code := challengeFor(t, service, sms, "device", "one")
	session, err := service.Verify(context.Background(), VerifyInput{ChallengeID: challenge.ID, Code: code, DeviceID: "device"})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SignOut(context.Background(), session.Token); err != nil {
		t.Fatalf("SignOut=%v,want success", err)
	}
	if _, err := service.RequireSession(context.Background(), session.Token); !errors.Is(err, ErrSessionRevoked) {
		t.Errorf("Signed-out token=%v,want revoked", err)
	}
	if err := service.SignOut(context.Background(), session.Token); err != nil {
		t.Errorf("Repeated SignOut=%v,want idempotent success", err)
	}
}

func TestTransactionAuthorizationRejectsStaleOrChangedPrincipal(t *testing.T) {
	service, sms, pool, _ := fixture(t)
	ctx := context.Background()
	challenge, err := service.Start(ctx, StartInput{Phone: "+6281234567890", DeviceID: "phone-one", OperationID: "operation-one", Network: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.Verify(ctx, VerifyInput{ChallengeID: challenge.ID, Code: sms.code, DeviceID: "phone-one"})
	if err != nil {
		t.Fatal(err)
	}
	principal, err := service.RequireSession(ctx, session.Token)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.LockSession(ctx, tx, principal); err != nil {
		tx.Rollback(ctx)
		t.Fatalf("current transaction authorization: %v", err)
	}
	tx.Rollback(ctx)
	changed := principal
	changed.DeviceID = "another-phone"
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.LockSession(ctx, tx, changed); !errors.Is(err, ErrSessionRevoked) {
		t.Errorf("changed principal accepted: %v", err)
	}
	tx.Rollback(ctx)
	if err := service.SignOut(ctx, session.Token); err != nil {
		t.Fatal(err)
	}
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := service.LockSession(ctx, tx, principal); !errors.Is(err, ErrSessionRevoked) {
		t.Errorf("revoked transaction principal accepted: %v", err)
	}
}

func TestAuthorizedMutationHoldsSessionUntilItsTransactionFinishes(t *testing.T) {
	service, sms, pool, _ := fixture(t)
	ctx := context.Background()
	challenge, err := service.Start(ctx, StartInput{Phone: "+6281234567890", DeviceID: "phone-one", OperationID: "operation-one", Network: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.Verify(ctx, VerifyInput{ChallengeID: challenge.ID, Code: sms.code, DeviceID: "phone-one"})
	if err != nil {
		t.Fatal(err)
	}
	principal, err := service.RequireSession(ctx, session.Token)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := service.LockSession(ctx, tx, principal); err != nil {
		t.Fatal(err)
	}
	revoke, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer revoke.Rollback(ctx)
	if _, err := revoke.Exec(ctx, "SET LOCAL lock_timeout='50ms'"); err != nil {
		t.Fatal(err)
	}
	if _, err := revoke.Exec(ctx, "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", principal.SessionID); err == nil {
		t.Fatal("session revocation raced past authorized transaction")
	}
	revoke.Rollback(ctx)
	replacement, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer replacement.Rollback(ctx)
	if _, err := replacement.Exec(ctx, "SET LOCAL lock_timeout='50ms'"); err != nil {
		t.Fatal(err)
	}
	if _, err := replacement.Exec(ctx, "UPDATE auth_accounts SET generation=generation+1 WHERE id=$1", principal.AccountID); err == nil {
		t.Fatal("replacement generation raced past authorized transaction")
	}
	replacement.Rollback(ctx)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := service.SignOut(ctx, session.Token); err != nil {
		t.Fatalf("revocation after commit: %v", err)
	}
}
