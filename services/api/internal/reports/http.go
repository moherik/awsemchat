package reports

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

func NewHandler(service *Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/reports", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.URL.ForceQuery {
			failure(w, ErrInvalid)
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
		decoder.DisallowUnknownFields()
		var input *Input
		if decoder.Decode(&input) != nil || input == nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.Create(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), *input)
		if err != nil {
			failure(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(result)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func failure(w http.ResponseWriter, err error) {
	status, code := http.StatusServiceUnavailable, "UNAVAILABLE"
	switch {
	case errors.Is(err, ErrInvalid):
		status, code = http.StatusBadRequest, "INVALID_INPUT"
	case errors.Is(err, ErrDenied):
		status, code = http.StatusForbidden, "DENIED"
	case errors.Is(err, ErrConflict):
		status, code = http.StatusConflict, "OPERATION_CONFLICT"
	case errors.Is(err, auth.ErrSessionRevoked):
		status, code = http.StatusUnauthorized, "SESSION_REVOKED"
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}
