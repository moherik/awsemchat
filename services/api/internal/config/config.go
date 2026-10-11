package config

import (
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"strconv"
)

var ErrInvalidConfig = errors.New("server configuration missing or unsafe")

type Config struct {
	Bind        string
	DatabaseURL string
	Pepper      []byte
}

func Load(env func(string) string) (Config, error) {
	if env("AWSEM_AUTH_MODE") != "development-mock" {
		return Config{}, ErrInvalidConfig
	}
	cfg := Config{Bind: env("AWSEM_BIND"), DatabaseURL: env("DATABASE_URL")}
	if cfg.Bind == "" {
		cfg.Bind = "127.0.0.1:8088"
	}
	if !LocalBind(cfg.Bind) || cfg.DatabaseURL == "" {
		return Config{}, ErrInvalidConfig
	}
	var err error
	cfg.Pepper, err = hex.DecodeString(env("AWSEM_AUTH_PEPPER_HEX"))
	if err != nil || len(cfg.Pepper) != 32 {
		return Config{}, ErrInvalidConfig
	}
	var nonzero byte
	for _, b := range cfg.Pepper {
		nonzero |= b
	}
	if nonzero == 0 {
		return Config{}, ErrInvalidConfig
	}
	return cfg, nil
}

func LocalBind(bind string) bool {
	host, port, err := net.SplitHostPort(bind)
	if err != nil {
		return false
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || !ip.Unmap().IsLoopback() {
		return false
	}
	n, err := strconv.Atoi(port)
	return err == nil && n >= 1 && n <= 65535
}
