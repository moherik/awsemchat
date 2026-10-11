package friends

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
)

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if status == 204 {
		w.WriteHeader(status)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, err error) {
	status, code := 503, "UNAVAILABLE"
	switch {
	case errors.Is(err, ErrDenied):
		status, code = 403, "DENIED"
	case errors.Is(err, ErrInvalid):
		status, code = 400, "INVALID_INPUT"
	case errors.Is(err, auth.ErrSessionRevoked):
		status, code = 401, "SESSION_REVOKED"
	}
	respond(w, status, map[string]string{"code": code})
}
func body(w http.ResponseWriter, r *http.Request, target any) bool {
	if r.URL.RawQuery != "" {
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target) == nil && errors.Is(decoder.Decode(new(any)), io.EOF)
}
func NewHandler(service *Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/friends", func(w http.ResponseWriter, r *http.Request) {
		actor := r.Context().Value(principalKey{}).(auth.Principal)
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			failure(w, ErrInvalid)
			return
		}
		for key, values := range query {
			if (key != "kind" && key != "cursor" && key != "limit") || len(values) != 1 {
				failure(w, ErrInvalid)
				return
			}
		}
		kind := query.Get("kind")
		if kind == "" {
			kind = "accepted"
		}
		limit := 25
		if value, exists := query["limit"]; exists {
			limit, err = strconv.Atoi(value[0])
			if err != nil {
				failure(w, ErrInvalid)
				return
			}
		}
		page, err := service.List(r.Context(), actor, kind, query.Get("cursor"), limit)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, page)
	})
	mux.HandleFunc("POST /v1/friends/requests", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			PIN string `json:"pin"`
		}
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.Request(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), input.PIN)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, result)
	})
	mux.HandleFunc("POST /v1/friends/requests/{requestID}/response", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Accept *bool `json:"accept"`
		}
		if !body(w, r, &input) || input.Accept == nil {
			failure(w, ErrInvalid)
			return
		}
		if err := service.Respond(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("requestID"), *input.Accept); err != nil {
			failure(w, err)
			return
		}
		respond(w, 204, nil)
	})
	mux.HandleFunc("PUT /v1/friends/blocks/{accountID}", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Blocked *bool `json:"blocked"`
		}
		if !body(w, r, &input) || input.Blocked == nil {
			failure(w, ErrInvalid)
			return
		}
		if err := service.Block(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("accountID"), *input.Blocked); err != nil {
			failure(w, err)
			return
		}
		respond(w, 204, nil)
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

type principalKey struct{}
