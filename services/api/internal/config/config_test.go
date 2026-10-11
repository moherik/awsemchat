package config

import (
	"errors"
	"strings"
	"testing"
)

func TestExplicitDevelopmentModeRequiresLoopbackAndSecret(t *testing.T) {
	t.Parallel()
	base := map[string]string{"AWSEM_AUTH_MODE": "development-mock", "DATABASE_URL": "postgres://synthetic@localhost/test", "AWSEM_AUTH_PEPPER_HEX": strings.Repeat("42", 32)}
	for _, tt := range []struct {
		name, field, value string
		valid              bool
	}{
		{"valid defaults", "", "", true}, {"missing mode", "AWSEM_AUTH_MODE", "", false}, {"public mock bind", "AWSEM_BIND", "0.0.0.0:8088", false},
		{"missing pepper", "AWSEM_AUTH_PEPPER_HEX", "", false}, {"zero pepper", "AWSEM_AUTH_PEPPER_HEX", strings.Repeat("00", 32), false},
		{"missing database", "DATABASE_URL", "", false}, {"unconfigured production provider", "AWSEM_AUTH_MODE", "production", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			values := make(map[string]string, len(base))
			for k, v := range base {
				values[k] = v
			}
			if tt.field != "" {
				values[tt.field] = tt.value
			}
			cfg, err := Load(func(name string) string { return values[name] })
			if tt.valid {
				if err != nil || cfg.Bind != "127.0.0.1:8088" || len(cfg.Pepper) != 32 {
					t.Errorf("Load(valid development)=%v,want loopback configuration", err)
				}
			} else if !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("Load(%s)=%v,want invalid", tt.name, err)
			}
		})
	}
}
