package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/config"
	"awsemchat/services/api/internal/friends"
	"awsemchat/services/api/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func New(ctx context.Context, pool *pgxpool.Pool, cfg config.Config) (*http.Server, error) {
	if !config.LocalBind(cfg.Bind) {
		return nil, config.ErrInvalidConfig
	}
	if err := migrations.Ready(ctx, pool); err != nil {
		return nil, err
	}
	sms := auth.NewDevelopmentSMS(time.Now)
	service, err := auth.NewService(pool, sms, auth.Config{Pepper: cfg.Pepper})
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("/", auth.NewHandler(service, true))
	social := friends.NewHandler(friends.NewService(pool, service))
	mux.Handle("/v1/friends", social)
	mux.Handle("/v1/friends/", social)
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		if err := migrations.Ready(ctx, pool); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"unavailable"}`))
			return
		}
		w.Write([]byte(`{"status":"ready"}`))
	})
	return &http.Server{Addr: cfg.Bind, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}, nil
}

func Serve(ctx context.Context, srv *http.Server, listener net.Listener) error {
	done := make(chan error, 1)
	go func() { done <- srv.Serve(listener) }()
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := srv.Shutdown(shutdownCtx)
		if err != nil {
			srv.Close()
		}
		serveErr := <-done
		if err != nil {
			return err
		}
		if errors.Is(serveErr, http.ErrServerClosed) {
			return nil
		}
		return serveErr
	}
}
