package circles

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
	case errors.Is(err, ErrInvalid):
		status, code = 400, "INVALID_INPUT"
	case errors.Is(err, ErrDenied):
		status, code = 403, "DENIED"
	case errors.Is(err, ErrFull):
		status, code = 409, "CIRCLE_FULL"
	case errors.Is(err, ErrAdminHandoff):
		status, code = 409, "ADMIN_HANDOFF_REQUIRED"
	case errors.Is(err, ErrOperationConflict):
		status, code = 409, "OPERATION_CONFLICT"
	case errors.Is(err, ErrMembershipChanged):
		status, code = 409, "MEMBERSHIP_CHANGED"
	case errors.Is(err, auth.ErrSessionRevoked):
		status, code = 401, "SESSION_REVOKED"
	}
	respond(w, status, map[string]string{"code": code})
}
func body(w http.ResponseWriter, r *http.Request, target any) bool {
	if r.URL.RawQuery != "" {
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	return d.Decode(target) == nil && errors.Is(d.Decode(new(any)), io.EOF)
}

type principalKey struct{}

func NewHandler(service *Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/circles/{circleID}/membership-operations/cancel", func(w http.ResponseWriter, r *http.Request) {
		var input MembershipMutation
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.CancelMembership(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("circleID"), input)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, result)
	})
	mux.HandleFunc("POST /v1/circles/{circleID}/membership-operations", func(w http.ResponseWriter, r *http.Request) {
		var input MembershipMutation
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		result, err := service.MutateMembership(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("circleID"), input)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, result)
	})
	mux.HandleFunc("GET /v1/circles", func(w http.ResponseWriter, r *http.Request) {
		cursor, limit, err := paging(r)
		if err != nil {
			failure(w, err)
			return
		}
		page, err := service.List(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), cursor, limit)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, page)
	})
	mux.HandleFunc("GET /v1/circles/invitations", func(w http.ResponseWriter, r *http.Request) {
		cursor, limit, err := paging(r)
		if err != nil {
			failure(w, err)
			return
		}
		page, err := service.Invitations(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), cursor, limit)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, page)
	})
	mux.HandleFunc("GET /v1/circles/{circleID}", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			failure(w, ErrInvalid)
			return
		}
		d, err := service.Details(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("circleID"))
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, d)
	})

	mux.HandleFunc("POST /v1/circles", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			OperationID string `json:"operationId"`
		}
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		c, err := service.Create(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), input.OperationID)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, c)
	})
	mux.HandleFunc("POST /v1/circles/{circleID}/invitations", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			AccountID string `json:"accountId"`
		}
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		i, err := service.Invite(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("circleID"), input.AccountID)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, i)
	})
	mux.HandleFunc("POST /v1/circles/invitations/{invitationID}/response", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Accept *bool `json:"accept"`
		}
		if !body(w, r, &input) || input.Accept == nil {
			failure(w, ErrInvalid)
			return
		}
		i, err := service.Respond(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("invitationID"), *input.Accept)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, i)
	})
	mux.HandleFunc("POST /v1/circles/{circleID}/leave", func(w http.ResponseWriter, r *http.Request) {
		var input struct{}
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		if err := service.Leave(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("circleID")); err != nil {
			failure(w, err)
			return
		}
		respond(w, 204, nil)
	})
	mux.HandleFunc("POST /v1/circles/{circleID}/members/{accountID}/remove", func(w http.ResponseWriter, r *http.Request) {
		var input struct{}
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		if err := service.Remove(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("circleID"), r.PathValue("accountID")); err != nil {
			failure(w, err)
			return
		}
		respond(w, 204, nil)
	})
	mux.HandleFunc("POST /v1/circles/{circleID}/handoff", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			AccountID string `json:"accountId"`
		}
		if !body(w, r, &input) {
			failure(w, ErrInvalid)
			return
		}
		if err := service.Handoff(r.Context(), r.Context().Value(principalKey{}).(auth.Principal), r.PathValue("circleID"), input.AccountID); err != nil {
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

func paging(r *http.Request) (string, int, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return "", 0, ErrInvalid
	}
	for key, values := range query {
		if (key != "cursor" && key != "limit") || len(values) != 1 {
			return "", 0, ErrInvalid
		}
	}
	limit := 25
	if value, present := query["limit"]; present {
		limit, err = strconv.Atoi(value[0])
		if err != nil {
			return "", 0, ErrInvalid
		}
	}
	return query.Get("cursor"), limit, nil
}
