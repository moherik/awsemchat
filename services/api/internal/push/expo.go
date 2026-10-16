package push

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalidToken        = errors.New("invalid Expo push token")
	ErrDeviceNotRegistered = errors.New("Expo push device is not registered")
	ErrUnavailable         = errors.New("Expo push service unavailable")
)

type ExpoProvider struct {
	endpoint string
	client   *http.Client
}

func ShouldNotify(contentType string) bool {
	return contentType == "" || contentType == "text" || contentType == "ping" || contentType == "pong"
}

func retryDelay(attempt int) time.Duration {
	if attempt <= 1 {
		return time.Second
	}
	if attempt >= 7 {
		return time.Minute
	}
	return time.Second * time.Duration(1<<(attempt-1))
}

func QueueRecipient(ctx context.Context, tx pgx.Tx, eventID, conversation, contentType, accountID string, generation int64) error {
	if !ShouldNotify(contentType) {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO notification_outbox(event_id,account_id,generation)
		SELECT $1,d.account_id,d.generation FROM notification_devices d
		WHERE d.account_id=$2 AND d.generation=$3 AND NOT ($4=ANY(d.muted_conversations))
		ON CONFLICT(event_id,account_id,generation) DO NOTHING`, eventID, accountID, generation, conversation)
	return err
}

func NewExpoProvider(endpoint string, client *http.Client) *ExpoProvider {
	if endpoint == "" {
		endpoint = "https://exp.host/--/api/v2/push/send"
	}
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	return &ExpoProvider{endpoint: endpoint, client: client}
}

type expoTicket struct {
	Data struct {
		Status  string `json:"status"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
}

// Send emits a generic nudge. Conversation identity and message content never leave the API.
func (p *ExpoProvider) Send(ctx context.Context, token string) error {
	if !validExpoToken(token) {
		return ErrInvalidToken
	}
	payload, err := json.Marshal(map[string]any{
		"to": token, "title": "AwsemChat", "body": "You have a new message",
		"data": map[string]string{"type": "new-message"}, "channelId": "messages",
		"priority": "high", "ttl": 60,
	})
	if err != nil {
		return ErrUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(payload))
	if err != nil {
		return ErrUnavailable
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	response, err := p.client.Do(request)
	if err != nil {
		return fmt.Errorf("send Expo push: %w", ErrUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Expo push HTTP %d: %w", response.StatusCode, ErrUnavailable)
	}
	var ticket expoTicket
	if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&ticket); err != nil {
		return fmt.Errorf("decode Expo ticket: %w", ErrUnavailable)
	}
	if ticket.Data.Status == "error" {
		if ticket.Data.Details.Error == "DeviceNotRegistered" {
			return ErrDeviceNotRegistered
		}
		return fmt.Errorf("Expo push ticket rejected: %w", ErrUnavailable)
	}
	if ticket.Data.Status != "ok" {
		return fmt.Errorf("Expo push ticket missing status: %w", ErrUnavailable)
	}
	return nil
}

func validExpoToken(token string) bool {
	if !strings.HasPrefix(token, "ExpoPushToken[") || !strings.HasSuffix(token, "]") || len(token) > 256 {
		return false
	}
	value := strings.TrimSuffix(strings.TrimPrefix(token, "ExpoPushToken["), "]")
	if value == "" {
		return false
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("-_.:", r)) {
			return false
		}
	}
	return true
}
