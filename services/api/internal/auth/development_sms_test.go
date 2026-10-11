package auth

import (
	"context"
	"testing"
	"time"
)

func TestDevelopmentCodeExpiresAndCannotSendAfterCancellation(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC)
	sms := NewDevelopmentSMS(func() time.Time { return now })
	if err := sms.SendCode(context.Background(), "+6281234567890", "123456"); err != nil {
		t.Fatal(err)
	}
	if code, ok := sms.Code("+6281234567890"); !ok || code != "123456" {
		t.Errorf("Code(valid)=%q/%v,want123456/true", code, ok)
	}
	now = now.Add(5 * time.Minute)
	if _, ok := sms.Code("+6281234567890"); ok {
		t.Error("Code(expired) remains available")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := sms.SendCode(ctx, "+6281234567890", "654321"); err == nil {
		t.Error("SendCode(cancelled) succeeded")
	}
	if _, ok := sms.Code("+6281234567890"); ok {
		t.Error("Cancelled send saved a code")
	}
}
