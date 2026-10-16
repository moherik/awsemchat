package push

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"awsemchat/services/api/internal/auth"
)

func TestRegisterRejectsInvalidTokenBeforeDatabaseAccess(t *testing.T) {
	t.Parallel()
	service := NewDeviceService(nil, nil)
	err := service.Register(context.Background(), auth.Principal{AccountID: "account-1", Generation: 1}, "native-fcm-token", nil)
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("Register(native token) error = %v, want ErrInvalidToken", err)
	}
}

func TestValidateMutedConversations(t *testing.T) {
	t.Parallel()
	conversation := "private:" + strings.Repeat("a", 64)
	got, err := validateMutedConversations([]string{conversation, conversation, "circle:circle-1"})
	if err != nil || len(got) != 2 || got[0] != "circle:circle-1" || got[1] != conversation {
		t.Errorf("validateMutedConversations(valid) = %v, %v, want unique sorted conversations", got, err)
	}
	if _, err := validateMutedConversations([]string{"private:not-a-conversation-id"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("validateMutedConversations(invalid) error = %v, want ErrInvalid", err)
	}
}

func TestUpdatePreferencesRejectsInvalidConversationBeforeDatabase(t *testing.T) {
	t.Parallel()
	service := NewDeviceService(nil, nil)
	err := service.UpdatePreferences(context.Background(), auth.Principal{AccountID: "account-1", Generation: 1}, []string{"private:not-valid"})
	if !errors.Is(err, ErrInvalid) {
		t.Errorf("UpdatePreferences(invalid conversation) error = %v, want ErrInvalid", err)
	}
}

func TestStatusRequiresDatabase(t *testing.T) {
	t.Parallel()
	_, err := NewDeviceService(nil, nil).Status(context.Background(), auth.Principal{AccountID: "account-1", Generation: 1})
	if !errors.Is(err, ErrUnavailable) {
		t.Errorf("Status(without service) error = %v, want ErrUnavailable", err)
	}
}

func TestDeviceHandlerRequiresBearerSession(t *testing.T) {
	t.Parallel()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/notifications/device", strings.NewReader(`{"expoPushToken":"ExpoPushToken[abc123]"}`))
	NewDeviceHandler(nil).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Errorf("notification registration without bearer token status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}
