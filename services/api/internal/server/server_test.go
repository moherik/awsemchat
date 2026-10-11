package server

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"awsemchat/services/api/internal/config"
	"awsemchat/services/api/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServerRequiresExplicitMigrationAndServesAuthentication(t *testing.T) {
	url := os.Getenv("AWSEM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("real PostgreSQL fixture required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "server_test_" + rand.Text()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	pc, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	pc.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	cfg := config.Config{Bind: "127.0.0.1:8088", Pepper: []byte(strings.Repeat("p", 32))}
	if _, err := New(ctx, pool, cfg); !errors.Is(err, migrations.ErrSchema) {
		t.Fatalf("unmigrated startup: %v", err)
	}
	var ledgerExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('schema_migrations') IS NOT NULL").Scan(&ledgerExists); err != nil || ledgerExists {
		t.Fatalf("startup mutated schema: exists=%v,error=%v", ledgerExists, err)
	}
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	srv, err := New(ctx, pool, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if srv.Addr != "127.0.0.1:8088" || srv.ReadHeaderTimeout <= 0 || srv.ReadTimeout <= 0 || srv.WriteTimeout <= 0 || srv.IdleTimeout <= 0 {
		t.Fatal("missing bounded server configuration")
	}
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:40000"
		w := httptest.NewRecorder()
		srv.Handler.ServeHTTP(w, r)
		return w
	}
	if w := call(http.MethodGet, "/health/ready", ""); w.Code != 200 {
		t.Fatalf("ready=%d", w.Code)
	}
	w := call(http.MethodPost, "/v1/auth/challenges", `{"phone":"+6281234567890","deviceId":"test-device","operationId":"test-op"}`)
	if w.Code != 202 {
		t.Fatalf("challenge=%d %s", w.Code, w.Body.String())
	}
	var challenge struct {
		ID string `json:"challengeId"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &challenge); err != nil || challenge.ID == "" {
		t.Fatalf("challenge body=%s", w.Body.String())
	}
	w = call(http.MethodPost, "/dev/otp", `{"phone":"+6281234567890"}`)
	var code struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &code); err != nil || len(code.Code) != 6 {
		t.Fatalf("mock code body=%s", w.Body.String())
	}
	w = call(http.MethodPost, "/v1/auth/verify", `{"challengeId":"`+challenge.ID+`","code":"`+code.Code+`","deviceId":"test-device"}`)
	if w.Code != 200 {
		t.Fatalf("verify=%d %s", w.Code, w.Body.String())
	}
	if _, err := pool.Exec(ctx, "DROP TABLE auth_sessions"); err != nil {
		t.Fatal(err)
	}
	if w := call(http.MethodGet, "/health/ready", ""); w.Code != 503 || strings.Contains(w.Body.String(), "auth_sessions") {
		t.Fatalf("broken database readiness=%d %s", w.Code, w.Body.String())
	}
}

func TestMockServerRejectsPublicBindingEvenWhenCalledDirectly(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://synthetic@127.0.0.1:1/test?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = New(context.Background(), pool, config.Config{Bind: "0.0.0.0:8088", Pepper: []byte(strings.Repeat("p", 32))})
	if !errors.Is(err, config.ErrInvalidConfig) {
		t.Fatalf("public mock configuration=%v", err)
	}
}

func TestServerStopsOnCancellationAndClosesListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })}
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, srv, listener) }()
	client := http.Client{Timeout: time.Second}
	response, err := client.Get("http://" + listener.Addr().String())
	if err != nil {
		t.Fatalf("server did not serve: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatalf("server response=%d", response.StatusCode)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("shutdown: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop")
	}
	if conn, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second); err == nil {
		conn.Close()
		t.Fatal("shutdown left listener open")
	}
}
