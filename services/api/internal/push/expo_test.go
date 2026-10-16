package push

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func TestExpoProviderSendsContentFreeMessage(t *testing.T) {
	t.Parallel()
	var got map[string]any
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodPost {
			t.Errorf("Expo request method = %q, want POST", r.Method)
		}
		if got := r.Header.Get("Accept"); !strings.Contains(got, "application/json") {
			t.Errorf("Expo Accept header = %q, want application/json", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode Expo request: %v", err)
		}
		result := response(http.StatusOK, `{"data":{"status":"ok","id":"ticket-1"}}`)
		result.Header.Set("Content-Type", "application/json")
		return result, nil
	})}

	provider := NewExpoProvider("https://expo.invalid/send", client)
	if err := provider.Send(context.Background(), "ExpoPushToken[abc123]"); err != nil {
		t.Fatalf("Send(valid token) error = %v, want nil", err)
	}
	if got["to"] != "ExpoPushToken[abc123]" || got["title"] != "AwsemChat" || got["body"] != "You have a new message" {
		t.Errorf("Expo payload = %#v, want generic title and body addressed to the token", got)
	}
	if _, ok := got["data"].(map[string]any); !ok {
		t.Errorf("Expo payload data = %#v, want generic routing data", got["data"])
	}
	for _, forbidden := range []string{"conversation", "sender", "message", "ciphertext", "eventId"} {
		if _, ok := got[forbidden]; ok {
			t.Errorf("Expo payload contains private field %q: %#v", forbidden, got)
		}
	}
}

func TestExpoProviderRejectsUnregisteredDevice(t *testing.T) {
	t.Parallel()
	client := &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return response(http.StatusOK, `{"data":{"status":"error","details":{"error":"DeviceNotRegistered"}}}`), nil
	})}

	err := NewExpoProvider("https://expo.invalid/send", client).Send(context.Background(), "ExpoPushToken[abc123]")
	if !errors.Is(err, ErrDeviceNotRegistered) {
		t.Errorf("Send(unregistered token) error = %v, want ErrDeviceNotRegistered", err)
	}
}

func TestShouldNotifyOnlyUserVisibleMessageEvents(t *testing.T) {
	t.Parallel()
	tests := []struct {
		contentType string
		want        bool
	}{
		{contentType: "", want: true},
		{contentType: "text", want: true},
		{contentType: "ping", want: true},
		{contentType: "pong", want: true},
		{contentType: "now-playing", want: false},
		{contentType: "circle-profile", want: false},
		{contentType: "circle-collection", want: false},
		{contentType: "redaction-control", want: false},
	}
	for _, test := range tests {
		t.Run(test.contentType, func(t *testing.T) {
			t.Parallel()
			if got := ShouldNotify(test.contentType); got != test.want {
				t.Errorf("ShouldNotify(%q) = %t, want %t", test.contentType, got, test.want)
			}
		})
	}
}

func TestRetryDelayGrowsAndCaps(t *testing.T) {
	t.Parallel()
	if got, want := retryDelay(1), time.Second; got != want {
		t.Errorf("retryDelay(1) = %v, want %v", got, want)
	}
	if got, want := retryDelay(4), 8*time.Second; got != want {
		t.Errorf("retryDelay(4) = %v, want %v", got, want)
	}
	if got, want := retryDelay(20), time.Minute; got != want {
		t.Errorf("retryDelay(20) = %v, want %v", got, want)
	}
}
