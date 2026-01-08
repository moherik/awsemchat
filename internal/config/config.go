package config

import (
	"os"
)

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
}

func LoadConfig() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", "host=localhost user=postgres password=postgres dbname=awsemchat port=5432 sslmode=disable TimeZone=Asia/Jakarta"),
		JWTSecret:   getEnv("JWT_SECRET", "supersecretkey"),
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
