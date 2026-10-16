package config

import (
	"errors"
	"reflect"
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

func TestLocalMediaRootMustBeExplicitAndAbsolute(t *testing.T) {
	values := map[string]string{"AWSEM_AUTH_MODE": "development-mock", "DATABASE_URL": "postgres://localhost/test", "AWSEM_AUTH_PEPPER_HEX": strings.Repeat("42", 32), "AWSEM_MEDIA_LOCAL_ROOT": "/private/tmp/awsem-media"}
	cfg, err := Load(func(k string) string { return values[k] })
	if err != nil || cfg.MediaLocalRoot != "/private/tmp/awsem-media" {
		t.Fatalf("local media config: %+v %v", cfg, err)
	}
	values["AWSEM_MEDIA_LOCAL_ROOT"] = "relative"
	if _, err := Load(func(k string) string { return values[k] }); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("relative root: %v", err)
	}
}

func TestSupabaseMediaConfigurationIsCompleteAndExclusive(t *testing.T) {
	values := map[string]string{
		"AWSEM_AUTH_MODE":                  "development-mock",
		"DATABASE_URL":                     "postgres://localhost/test",
		"AWSEM_AUTH_PEPPER_HEX":            strings.Repeat("42", 32),
		"AWSEM_MEDIA_SUPABASE_URL":         "https://project.supabase.co",
		"AWSEM_MEDIA_SUPABASE_SERVICE_KEY": "server-only-key",
		"AWSEM_MEDIA_SUPABASE_BUCKET":      "private-media",
	}
	load := func() (Config, error) { return Load(func(key string) string { return values[key] }) }
	cfg, err := load()
	if err != nil {
		t.Fatalf("Load(complete Supabase media config) = %v", err)
	}
	for field, want := range map[string]string{
		"MediaSupabaseURL":        values["AWSEM_MEDIA_SUPABASE_URL"],
		"MediaSupabaseServiceKey": values["AWSEM_MEDIA_SUPABASE_SERVICE_KEY"],
		"MediaSupabaseBucket":     values["AWSEM_MEDIA_SUPABASE_BUCKET"],
	} {
		got := reflect.ValueOf(cfg).FieldByName(field)
		if !got.IsValid() || got.String() != want {
			t.Errorf("%s = %v, want configured value", field, got)
		}
	}
	values["AWSEM_MEDIA_SUPABASE_SERVICE_KEY"] = ""
	if _, err := load(); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("Load(partial Supabase config) = %v, want invalid", err)
	}
	values["AWSEM_MEDIA_SUPABASE_SERVICE_KEY"] = "server-only-key"
	values["AWSEM_MEDIA_LOCAL_ROOT"] = "/private/tmp/media"
	if _, err := load(); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("Load(conflicting media backends) = %v, want invalid", err)
	}
}
