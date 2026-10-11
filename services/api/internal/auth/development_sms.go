package auth

import (
	"context"
	"sync"
	"time"
)

type developmentCode struct {
	value   string
	expires time.Time
}

// DevelopmentSMS stores synthetic delivery in memory; server configuration forbids it in production mode.
type DevelopmentSMS struct {
	mu    sync.Mutex
	codes map[string]developmentCode
	now   func() time.Time
}

func NewDevelopmentSMS(now func() time.Time) *DevelopmentSMS {
	if now == nil {
		now = time.Now
	}
	return &DevelopmentSMS{codes: make(map[string]developmentCode), now: now}
}
func (s *DevelopmentSMS) purge(now time.Time) {
	for phone, code := range s.codes {
		if !code.expires.After(now) {
			delete(s.codes, phone)
		}
	}
}
func (s *DevelopmentSMS) SendCode(ctx context.Context, phone, code string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !phonePattern.MatchString(phone) || !codePattern.MatchString(code) {
		return ErrInvalidInput
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.purge(now)
	if _, exists := s.codes[phone]; !exists && len(s.codes) >= 128 {
		return ErrRateLimited
	}
	s.codes[phone] = developmentCode{value: code, expires: now.Add(5 * time.Minute)}
	return nil
}
func (s *DevelopmentSMS) Code(phone string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purge(s.now())
	code, ok := s.codes[phone]
	return code.value, ok
}
