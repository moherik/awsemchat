package keys

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"awsemchat/services/api/internal/auth"
)

func keyFailure(w http.ResponseWriter, err error) {
	status, code := 503, "UNAVAILABLE"
	switch {
	case errors.Is(err, auth.ErrSessionRevoked):
		status, code = 401, "SESSION_REVOKED"
	case errors.Is(err, ErrDenied):
		status, code = 403, "DENIED"
	case errors.Is(err, ErrExhausted):
		status, code = 409, "KEYS_EXHAUSTED"
	case errors.Is(err, ErrConflict):
		status, code = 409, "PUBLICATION_CONFLICT"
	case errors.Is(err, ErrExpired):
		status, code = 400, "BUNDLE_EXPIRED"
	case errors.Is(err, ErrInvalid), errors.Is(err, ErrSignature):
		status, code = 400, "INVALID_INPUT"
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"code": code})
}
func authenticated(service *Service, r *http.Request) (auth.Principal, error) {
	if len(r.Header.Values("Authorization")) != 1 {
		return auth.Principal{}, auth.ErrSessionRevoked
	}
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return auth.Principal{}, auth.ErrSessionRevoked
	}
	return service.auth.RequireSession(r.Context(), token)
}
func NewHandler(service *Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/keys/publications", func(w http.ResponseWriter, r *http.Request) {
		actor, err := authenticated(service, r)
		if err != nil {
			keyFailure(w, err)
			return
		}
		if r.URL.RawQuery != "" {
			keyFailure(w, ErrInvalid)
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
		decoder.DisallowUnknownFields()
		var input *Registration
		if decoder.Decode(&input) != nil || input == nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
			keyFailure(w, ErrInvalid)
			return
		}
		if err := service.Publish(r.Context(), actor, *input, time.Now()); err != nil {
			keyFailure(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /v1/keys/allocations", func(w http.ResponseWriter, r *http.Request) {
		actor, err := authenticated(service, r)
		if err != nil {
			keyFailure(w, err)
			return
		}
		if r.URL.RawQuery != "" {
			keyFailure(w, ErrInvalid)
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		var input *AllocationRequest
		if decoder.Decode(&input) != nil || input == nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
			keyFailure(w, ErrInvalid)
			return
		}
		result, err := service.Allocate(r.Context(), actor, *input, time.Now())
		if err != nil {
			keyFailure(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(result)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}
