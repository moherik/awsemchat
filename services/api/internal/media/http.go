package media

import (
	"awsemchat/services/api/internal/auth"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func NewHandler(service *Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/media/circles/{circleID}/operations/{operationID}/cancel", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.URL.ForceQuery || r.ContentLength != 0 {
			mediaFailure(w, ErrInvalid)
			return
		}
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if len(r.Header.Values("Authorization")) != 1 || !ok || !strings.EqualFold(scheme, "Bearer") {
			mediaFailure(w, auth.ErrSessionRevoked)
			return
		}
		actor, err := service.auth.RequireSession(r.Context(), token)
		if err != nil {
			mediaFailure(w, err)
			return
		}
		result, err := service.CancelOperation(r.Context(), actor, r.PathValue("circleID"), r.PathValue("operationID"))
		if err != nil {
			mediaFailure(w, err)
			return
		}
		if result.State == "cancelled" {
			_, _ = service.DrainCleanup(r.Context(), 32)
		}
		mediaSuccess(w, result)
	})
	mux.HandleFunc("POST /v1/media/private/{peerID}/operations/{operationID}/cancel", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.ForceQuery || r.ContentLength != 0 {
			mediaFailure(w, ErrInvalid)
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query) != 1 || len(query["audience"]) != 1 {
			mediaFailure(w, ErrInvalid)
			return
		}
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if len(r.Header.Values("Authorization")) != 1 || !ok || !strings.EqualFold(scheme, "Bearer") {
			mediaFailure(w, auth.ErrSessionRevoked)
			return
		}
		actor, err := service.auth.RequireSession(r.Context(), token)
		if err != nil {
			mediaFailure(w, err)
			return
		}
		result, err := service.CancelPrivateOperation(r.Context(), actor, r.PathValue("peerID"), query.Get("audience"), r.PathValue("operationID"))
		if err != nil {
			mediaFailure(w, err)
			return
		}
		if result.State == "cancelled" {
			_, _ = service.DrainCleanup(r.Context(), 32)
		}
		mediaSuccess(w, result)
	})
	mux.HandleFunc("/v1/media/circles/{circleID}/objects/{objectID}", func(w http.ResponseWriter, r *http.Request) {
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if len(r.Header.Values("Authorization")) != 1 || !ok || !strings.EqualFold(scheme, "Bearer") {
			mediaFailure(w, auth.ErrSessionRevoked)
			return
		}
		actor, err := service.auth.RequireSession(r.Context(), token)
		if err != nil {
			mediaFailure(w, err)
			return
		}
		switch r.Method {
		case http.MethodPut:
			query, err := url.ParseQuery(r.URL.RawQuery)
			if err != nil || len(query) != 2 || len(query["epoch"]) != 1 || len(query["operation"]) != 1 || r.Header.Get("Content-Type") != "application/octet-stream" {
				mediaFailure(w, ErrInvalid)
				return
			}
			epoch, err := strconv.ParseInt(query.Get("epoch"), 10, 64)
			if err != nil {
				mediaFailure(w, ErrInvalid)
				return
			}
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCiphertext))
			if err != nil {
				var limit *http.MaxBytesError
				if errors.As(err, &limit) {
					mediaJSON(w, 413, "MEDIA_TOO_LARGE")
				} else {
					mediaFailure(w, ErrInvalid)
				}
				return
			}
			if err := service.PutCircle(r.Context(), actor, r.PathValue("circleID"), epoch, r.PathValue("objectID"), query.Get("operation"), body); err != nil {
				mediaFailure(w, err)
				return
			}
			w.WriteHeader(204)
		case http.MethodGet:
			if r.URL.RawQuery != "" || r.URL.ForceQuery {
				mediaFailure(w, ErrInvalid)
				return
			}
			body, err := service.GetCircle(r.Context(), actor, r.PathValue("circleID"), r.PathValue("objectID"))
			if err != nil {
				mediaFailure(w, err)
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			w.Write(body)
		default:
			w.Header().Set("Allow", "GET, PUT")
			mediaJSON(w, 405, "METHOD_NOT_ALLOWED")
		}
	})
	mux.HandleFunc("/v1/media/private/{peerID}/objects/{objectID}", func(w http.ResponseWriter, r *http.Request) {
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if len(r.Header.Values("Authorization")) != 1 || !ok || !strings.EqualFold(scheme, "Bearer") {
			mediaFailure(w, auth.ErrSessionRevoked)
			return
		}
		actor, err := service.auth.RequireSession(r.Context(), token)
		if err != nil {
			mediaFailure(w, err)
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query["audience"]) != 1 || len(query) != 1 && len(query) != 2 {
			mediaFailure(w, ErrInvalid)
			return
		}
		switch r.Method {
		case http.MethodPut:
			if len(query) != 2 || len(query["operation"]) != 1 || r.Header.Get("Content-Type") != "application/octet-stream" {
				mediaFailure(w, ErrInvalid)
				return
			}
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCiphertext))
			if err != nil {
				var limit *http.MaxBytesError
				if errors.As(err, &limit) {
					mediaJSON(w, 413, "MEDIA_TOO_LARGE")
				} else {
					mediaFailure(w, ErrInvalid)
				}
				return
			}
			if err := service.PutPrivate(r.Context(), actor, r.PathValue("peerID"), query.Get("audience"), r.PathValue("objectID"), query.Get("operation"), body); err != nil {
				mediaFailure(w, err)
				return
			}
			w.WriteHeader(204)
		case http.MethodGet:
			if len(query) != 1 || r.URL.ForceQuery {
				mediaFailure(w, ErrInvalid)
				return
			}
			body, err := service.GetPrivate(r.Context(), actor, r.PathValue("peerID"), query.Get("audience"), r.PathValue("objectID"))
			if err != nil {
				mediaFailure(w, err)
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			_, _ = w.Write(body)
		default:
			w.Header().Set("Allow", "GET, PUT")
			mediaJSON(w, 405, "METHOD_NOT_ALLOWED")
		}
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}

func mediaSuccess(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(value)
}

func mediaFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrSessionRevoked):
		mediaJSON(w, 401, "SESSION_REVOKED")
	case errors.Is(err, ErrInvalid):
		mediaJSON(w, 400, "INVALID_INPUT")
	case errors.Is(err, ErrDenied):
		mediaJSON(w, 403, "DENIED")
	case errors.Is(err, ErrConflict):
		mediaJSON(w, 409, "OBJECT_CONFLICT")
	case errors.Is(err, ErrOperationCancelled):
		mediaJSON(w, 409, "OPERATION_CANCELLED")
	default:
		mediaJSON(w, 503, "UNAVAILABLE")
	}
}

func mediaJSON(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"code": code})
}
