package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return false
	}
	return errors.Is(decoder.Decode(new(any)), io.EOF)
}
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		return
	}
}
func replyError(w http.ResponseWriter, err error) {
	status, code := http.StatusServiceUnavailable, "UNAVAILABLE"
	switch {
	case errors.Is(err, ErrInvalidInput):
		status, code = http.StatusBadRequest, "INVALID_INPUT"
	case errors.Is(err, ErrRateLimited):
		status, code = http.StatusTooManyRequests, "RATE_LIMITED"
		w.Header().Set("Retry-After", "60")
	case errors.Is(err, ErrInvalidCode):
		status, code = http.StatusUnauthorized, "INVALID_CODE"
	case errors.Is(err, ErrExpired):
		status, code = http.StatusGone, "EXPIRED"
	case errors.Is(err, ErrConsumed):
		status, code = http.StatusConflict, "CONSUMED"
	case errors.Is(err, ErrSessionRevoked):
		status, code = http.StatusUnauthorized, "SESSION_REVOKED"
	}
	reply(w, status, map[string]string{"code": code})
}
func requestToken(r *http.Request) string {
	if len(r.Header.Values("Authorization")) != 1 {
		return ""
	}
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return token
}
func NewHandler(service *Service, development bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/auth/challenges", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Phone       string `json:"phone"`
			DeviceID    string `json:"deviceId"`
			OperationID string `json:"operationId"`
		}
		if !decode(w, r, &input) {
			replyError(w, ErrInvalidInput)
			return
		}
		address, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			replyError(w, ErrInvalidInput)
			return
		}
		challenge, err := service.Start(r.Context(), StartInput{Phone: input.Phone, DeviceID: input.DeviceID, OperationID: input.OperationID, Network: address})
		if errors.Is(err, ErrChallengePending) {
			reply(w, http.StatusAccepted, struct {
				Challenge
				Status string `json:"status"`
			}{challenge, "pending"})
			return
		}
		if err != nil {
			replyError(w, err)
			return
		}
		reply(w, http.StatusAccepted, challenge)
	})
	mux.HandleFunc("POST /v1/auth/verify", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ChallengeID string `json:"challengeId"`
			Code        string `json:"code"`
			DeviceID    string `json:"deviceId"`
		}
		if !decode(w, r, &input) {
			replyError(w, ErrInvalidInput)
			return
		}
		session, err := service.Verify(r.Context(), VerifyInput{ChallengeID: input.ChallengeID, Code: input.Code, DeviceID: input.DeviceID})
		if err != nil {
			replyError(w, err)
			return
		}
		reply(w, http.StatusOK, session)
	})
	mux.HandleFunc("GET /v1/session", func(w http.ResponseWriter, r *http.Request) {
		principal, err := service.RequireSession(r.Context(), requestToken(r))
		if err != nil {
			replyError(w, err)
			return
		}
		reply(w, http.StatusOK, struct {
			AccountID  string    `json:"accountId"`
			DeviceID   string    `json:"deviceId"`
			Generation int64     `json:"generation"`
			ExpiresAt  time.Time `json:"expiresAt"`
		}{principal.AccountID, principal.DeviceID, principal.Generation, principal.ExpiresAt})
	})
	mux.HandleFunc("POST /v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if err := service.SignOut(r.Context(), requestToken(r)); err != nil {
			replyError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	if mock, ok := service.sms.(*DevelopmentSMS); development && ok {
		mux.HandleFunc("POST /dev/otp", func(w http.ResponseWriter, r *http.Request) {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			address, parseErr := netip.ParseAddr(host)
			if err != nil || parseErr != nil || !address.Unmap().IsLoopback() {
				reply(w, http.StatusForbidden, map[string]string{"code": "DEVELOPMENT_ONLY"})
				return
			}
			var input struct {
				Phone string `json:"phone"`
			}
			if !decode(w, r, &input) || !phonePattern.MatchString(input.Phone) {
				replyError(w, ErrInvalidInput)
				return
			}
			code, ok := mock.Code(input.Phone)
			if !ok {
				reply(w, http.StatusNotFound, map[string]string{"code": "NO_DEVELOPMENT_CODE"})
				return
			}
			reply(w, http.StatusOK, map[string]string{"code": code})
		})
	}
	return mux
}
