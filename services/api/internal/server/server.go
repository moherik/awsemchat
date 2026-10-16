package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/config"
	"awsemchat/services/api/internal/friends"
	"awsemchat/services/api/internal/keys"
	"awsemchat/services/api/internal/media"
	"awsemchat/services/api/internal/messages"
	"awsemchat/services/api/internal/push"
	"awsemchat/services/api/internal/reports"
	"awsemchat/services/api/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

type applicationHandler struct {
	http.Handler
	media   *media.Service
	reports *reports.Service
	push    *push.Dispatcher
}

func (h applicationHandler) RunCleanup(ctx context.Context) {
	var workers sync.WaitGroup
	if h.media != nil {
		workers.Add(1)
		go func() { defer workers.Done(); h.media.RunCleanup(ctx) }()
	}
	if h.reports != nil {
		workers.Add(1)
		go func() { defer workers.Done(); h.reports.RunCleanup(ctx) }()
	}
	if h.push != nil {
		workers.Add(1)
		go func() { defer workers.Done(); h.push.Run(ctx) }()
	}
	workers.Wait()
}

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
	circleHandler := circles.NewHandler(circles.NewService(pool, service))
	mux.Handle("/v1/circles", circleHandler)
	mux.Handle("/v1/circles/", circleHandler)
	mux.Handle("/v1/keys/", keys.NewHandler(keys.NewService(pool, service)))
	messageHandler := messages.NewHandler(messages.NewService(pool, service))
	mux.Handle("/v1/messages", messageHandler)
	mux.Handle("/v1/messages/", messageHandler)
	mux.Handle("/v1/notifications/", push.NewDeviceHandler(push.NewDeviceService(pool, service)))
	reportService := reports.NewService(pool, service)
	mux.Handle("/v1/reports", reports.NewHandler(reportService))
	mux.Handle("/v1/reports/", reports.NewHandler(reportService))
	var mediaService *media.Service
	if cfg.MediaSupabaseURL != "" || cfg.MediaSupabaseServiceKey != "" || cfg.MediaSupabaseBucket != "" {
		if cfg.MediaLocalRoot != "" {
			return nil, config.ErrInvalidConfig
		}
		store, err := media.NewSupabaseStore(cfg.MediaSupabaseURL, cfg.MediaSupabaseServiceKey, cfg.MediaSupabaseBucket)
		if err != nil {
			return nil, err
		}
		mediaService = media.NewService(pool, service, store)
		mux.Handle("/v1/media/", media.NewHandler(mediaService))
	} else if cfg.MediaLocalRoot != "" {
		store, err := media.NewLocalStore(cfg.MediaLocalRoot)
		if err != nil {
			return nil, err
		}
		mediaService = media.NewService(pool, service, store)
		mux.Handle("/v1/media/", media.NewHandler(mediaService))
	}
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
	return &http.Server{Addr: cfg.Bind, Handler: applicationHandler{Handler: mux, media: mediaService, reports: reportService, push: push.NewDispatcher(pool, push.NewExpoProvider("", nil))}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}, nil
}

func Serve(ctx context.Context, srv *http.Server, listener net.Listener) error {
	var stopWorker context.CancelFunc
	var workerDone chan struct{}
	if worker, ok := srv.Handler.(interface{ RunCleanup(context.Context) }); ok {
		workerCtx, cancel := context.WithCancel(ctx)
		stopWorker = cancel
		workerDone = make(chan struct{})
		go func() {
			defer close(workerDone)
			worker.RunCleanup(workerCtx)
		}()
	}
	defer func() {
		if stopWorker != nil {
			stopWorker()
			<-workerDone
		}
	}()
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
