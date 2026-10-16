package push

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"awsemchat/services/api/internal/auth"
)

type principalKey struct{}

func NewDeviceHandler(service *DeviceService) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/notifications/device", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || service == nil {
			writeFailure(w, ErrInvalid)
			return
		}
		registered, err := service.Status(r.Context(), principal(r))
		if err != nil {
			writeFailure(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]bool{"registered": registered})
	})
	mux.HandleFunc("POST /v1/notifications/device", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ExpoToken          string   `json:"expoPushToken"`
			MutedConversations []string `json:"mutedConversations"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if r.URL.RawQuery != "" || decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
			writeFailure(w, ErrInvalid)
			return
		}
		if service == nil {
			writeFailure(w, ErrUnavailable)
			return
		}
		if err := service.Register(r.Context(), principal(r), input.ExpoToken, input.MutedConversations); err != nil {
			writeFailure(w, err)
			return
		}
		writeSuccess(w)
	})
	mux.HandleFunc("PUT /v1/notifications/preferences", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			MutedConversations []string `json:"mutedConversations"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
		decoder.DisallowUnknownFields()
		if r.URL.RawQuery != "" || decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
			writeFailure(w, ErrInvalid)
			return
		}
		if service == nil {
			writeFailure(w, ErrUnavailable)
			return
		}
		if err := service.UpdatePreferences(r.Context(), principal(r), input.MutedConversations); err != nil {
			writeFailure(w, err)
			return
		}
		writeSuccess(w)
	})
	mux.HandleFunc("DELETE /v1/notifications/device", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			writeFailure(w, ErrInvalid)
			return
		}
		if service == nil {
			writeFailure(w, ErrUnavailable)
			return
		}
		if err := service.Unregister(r.Context(), principal(r)); err != nil {
			writeFailure(w, err)
			return
		}
		writeSuccess(w)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if len(r.Header.Values("Authorization")) != 1 {
			writeFailure(w, auth.ErrSessionRevoked)
			return
		}
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") {
			writeFailure(w, auth.ErrSessionRevoked)
			return
		}
		if service == nil || service.auth == nil {
			writeFailure(w, auth.ErrUnavailable)
			return
		}
		actor, err := service.auth.RequireSession(r.Context(), token)
		if err != nil {
			writeFailure(w, err)
			return
		}
		ctx := context.WithValue(r.Context(), principalKey{}, actor)
		mux.ServeHTTP(w, r.WithContext(ctx))
	})
}

func principal(r *http.Request) auth.Principal {
	return r.Context().Value(principalKey{}).(auth.Principal)
}

func writeSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusNoContent)
}

func writeFailure(w http.ResponseWriter, err error) {
	status, code := http.StatusServiceUnavailable, "UNAVAILABLE"
	switch {
	case errors.Is(err, auth.ErrSessionRevoked):
		status, code = http.StatusUnauthorized, "SESSION_REVOKED"
	case errors.Is(err, ErrInvalid), errors.Is(err, ErrInvalidToken):
		status, code = http.StatusBadRequest, "INVALID_INPUT"
	case errors.Is(err, auth.ErrUnavailable), errors.Is(err, ErrUnavailable):
		status, code = http.StatusServiceUnavailable, "UNAVAILABLE"
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}
