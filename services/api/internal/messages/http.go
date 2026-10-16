package messages

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/keys"
)

type principalKey struct{}

func failure(w http.ResponseWriter, err error) {
	status, code := 503, "UNAVAILABLE"
	switch {
	case errors.Is(err, auth.ErrSessionRevoked):
		status, code = 401, "SESSION_REVOKED"
	case errors.Is(err, ErrInvalid):
		status, code = 400, "INVALID_INPUT"
	case errors.Is(err, ErrDenied):
		status, code = 403, "DENIED"
	case errors.Is(err, ErrConflict):
		status, code = 409, "OPERATION_CONFLICT"
	case errors.Is(err, ErrRedacted):
		status, code = 409, "MESSAGE_REDACTED"
	case errors.Is(err, ErrCancelled):
		status, code = 409, "OPERATION_CANCELLED"
	case errors.Is(err, keys.ErrExhausted):
		status, code = 503, "KEYS_UNAVAILABLE"
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"code": code})
}
func body(w http.ResponseWriter, r *http.Request, target any, limit int64) bool {
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target) == nil && errors.Is(decoder.Decode(new(any)), io.EOF)
}
func success(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(value)
}
func NewHandler(service *Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/messages/profiles/cancel", func(w http.ResponseWriter, r *http.Request) {
		var input *struct {
			Envelope string `json:"envelope"`
		}
		if !body(w, r, &input, 4*1024*1024) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.CancelProfile(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), input.Envelope)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("POST /v1/messages/collections/cancel", func(w http.ResponseWriter, r *http.Request) {
		var input *struct {
			Envelope string `json:"envelope"`
		}
		if !body(w, r, &input, 4*1024*1024) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.CancelCollection(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), input.Envelope)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("POST /v1/messages/status", func(w http.ResponseWriter, r *http.Request) {
		var input *struct {
			EventID string `json:"eventId"`
		}
		if !body(w, r, &input, 4096) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.Status(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), input.EventID)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("POST /v1/messages/acknowledgements", func(w http.ResponseWriter, r *http.Request) {
		var input *struct {
			EventID string `json:"eventId"`
		}
		if !body(w, r, &input, 4096) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		if err := service.Acknowledge(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), input.EventID); err != nil {
			failure(w, err)
			return
		}
		success(w, nil)
	})
	mux.HandleFunc("POST /v1/messages/redactions", func(w http.ResponseWriter, r *http.Request) {
		var input *RedactionTarget
		if !body(w, r, &input, 4096) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.Redact(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), *input)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("GET /v1/messages/inbox", func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			failure(w, ErrInvalid)
			return
		}
		for key, values := range query {
			if (key != "cursor" && key != "limit") || len(values) != 1 {
				failure(w, ErrInvalid)
				return
			}
		}
		limit := 25
		if values, exists := query["limit"]; exists {
			limit, err = strconv.Atoi(values[0])
			if err != nil {
				failure(w, ErrInvalid)
				return
			}
		}
		if values, exists := query["cursor"]; exists && values[0] == "" {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.Inbox(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), query.Get("cursor"), limit)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("GET /v1/messages/history", func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			failure(w, ErrInvalid)
			return
		}
		for key, values := range query {
			if (key != "conversation" && key != "audience" && key != "cursor" && key != "limit") || len(values) != 1 || (key != "cursor" && values[0] == "") {
				failure(w, ErrInvalid)
				return
			}
		}
		limit := 25
		if value, exists := query["limit"]; exists {
			limit, err = strconv.Atoi(value[0])
			if err != nil {
				failure(w, ErrInvalid)
				return
			}
		}
		if query.Get("conversation") == "" || query.Get("audience") == "" {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.History(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), query.Get("conversation"), query.Get("audience"), query.Get("cursor"), limit)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("GET /v1/messages/redactions", func(w http.ResponseWriter, r *http.Request) {
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			failure(w, ErrInvalid)
			return
		}
		for key, values := range query {
			if (key != "cursor" && key != "limit") || len(values) != 1 || values[0] == "" {
				failure(w, ErrInvalid)
				return
			}
		}
		limit := 25
		if values, exists := query["limit"]; exists {
			limit, err = strconv.Atoi(values[0])
			if err != nil {
				failure(w, ErrInvalid)
				return
			}
		}
		result, err := service.Redactions(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), query.Get("cursor"), limit)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("POST /v1/messages/collections/manifest", func(w http.ResponseWriter, r *http.Request) {
		var input *CollectionManifestInput
		if !body(w, r, &input, 4096) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.CollectionManifest(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), *input)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("POST /v1/messages/context", func(w http.ResponseWriter, r *http.Request) {
		var input *ContextInput
		if !body(w, r, &input, 4096) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.Context(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), *input)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	mux.HandleFunc("POST /v1/messages", func(w http.ResponseWriter, r *http.Request) {
		var input *struct {
			Envelope string `json:"envelope"`
		}
		if !body(w, r, &input, 4*1024*1024) || input == nil {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.Send(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), input.Envelope)
		if err != nil {
			failure(w, err)
			return
		}
		success(w, result)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if len(r.Header.Values("Authorization")) != 1 {
			failure(w, auth.ErrSessionRevoked)
			return
		}
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") {
			failure(w, auth.ErrSessionRevoked)
			return
		}
		actor, err := service.auth.RequireSession(r.Context(), token)
		if err != nil {
			failure(w, err)
			return
		}
		mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, actor)))
	})
}
