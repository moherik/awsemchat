package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"awsemchat/services/api/internal/config"
	"awsemchat/services/api/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Print("authentication configuration missing or unsafe")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	pc, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Print("database configuration invalid")
		os.Exit(1)
	}
	pc.MaxConns = 16
	pc.MinConns = 0
	pc.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, err := pgxpool.NewWithConfig(startup, pc)
	if err != nil {
		log.Print("database initialization failed")
		os.Exit(1)
	}
	defer pool.Close()
	srv, err := server.New(startup, pool, cfg)
	if err != nil {
		log.Print("server startup refused; check explicit migrations and authentication configuration")
		os.Exit(1)
	}
	listener, err := net.Listen("tcp", cfg.Bind)
	if err != nil {
		log.Print("local server address unavailable")
		os.Exit(1)
	}
	log.Print("AwsemChat local development authentication server ready")
	if err := server.Serve(ctx, srv, listener); err != nil {
		log.Print("server stopped with an error")
		os.Exit(1)
	}
}
