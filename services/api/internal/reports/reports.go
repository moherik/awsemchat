package reports

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/friends"
	"awsemchat/services/api/internal/messages"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalid    = errors.New("invalid report")
	ErrDenied     = errors.New("report conversation denied")
	ErrConflict   = errors.New("report operation conflict")
	idPattern     = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
	reasonPattern = map[string]bool{"spam": true, "harassment": true, "scam": true, "something-else": true}
)

type SelectedMessage struct {
	EventID string `json:"eventId"`
	Text    string `json:"text"`
}

type Input struct {
	OperationID  string            `json:"operationId"`
	Conversation string            `json:"conversation"`
	SubjectID    string            `json:"subjectId"`
	Reason       string            `json:"reason"`
	Details      string            `json:"details"`
	Selected     []SelectedMessage `json:"selected"`
}

type Result struct {
	ID          string    `json:"id"`
	OperationID string    `json:"operationId"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type Service struct {
	pool *pgxpool.Pool
	auth *auth.Service
	now  func() time.Time
}

func NewService(pool *pgxpool.Pool, identity *auth.Service) *Service {
	return &Service{pool: pool, auth: identity, now: time.Now}
}

func ValidateInput(input Input) error {
	if !idPattern.MatchString(input.OperationID) || !idPattern.MatchString(input.SubjectID) || input.SubjectID == "." || input.SubjectID == ".." || !strings.HasPrefix(input.Conversation, "private:") || len(input.Conversation) != len("private:")+64 {
		return ErrInvalid
	}
	if !reasonPattern[input.Reason] || len(input.Details) > 1000 || len(input.Selected) > 20 {
		return ErrInvalid
	}
	seen := make(map[string]struct{}, len(input.Selected))
	for _, item := range input.Selected {
		if !idPattern.MatchString(item.EventID) || item.EventID == "." || item.EventID == ".." || len([]rune(strings.TrimSpace(item.Text))) == 0 || len([]rune(item.Text)) > 2000 {
			return ErrInvalid
		}
		if _, exists := seen[item.EventID]; exists {
			return ErrInvalid
		}
		seen[item.EventID] = struct{}{}
	}
	raw, err := json.Marshal(input)
	if err != nil || len(raw) > 32*1024 {
		return ErrInvalid
	}
	return nil
}

func (s *Service) Create(ctx context.Context, actor auth.Principal, input Input) (Result, error) {
	if err := ValidateInput(input); err != nil {
		return Result{}, err
	}
	if actor.AccountID == input.SubjectID || input.Conversation != messages.PrivateConversationID(actor.AccountID, input.SubjectID) {
		return Result{}, ErrDenied
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return Result{}, ErrInvalid
	}
	digest := sha256.Sum256(raw)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Result{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Result{}, err
	}
	if _, err := friends.NewService(s.pool, s.auth).AcceptedRequest(ctx, tx, actor, input.SubjectID); err != nil {
		if errors.Is(err, friends.ErrDenied) {
			return Result{}, ErrDenied
		}
		return Result{}, err
	}
	var existing Result
	var existingDigest []byte
	err = tx.QueryRow(ctx, `SELECT id,operation_id,expires_at,payload_digest FROM user_reports WHERE reporter_id=$1 AND operation_id=$2 FOR UPDATE`, actor.AccountID, input.OperationID).Scan(&existing.ID, &existing.OperationID, &existing.ExpiresAt, &existingDigest)
	if err == nil {
		if string(existingDigest) != string(digest[:]) {
			return Result{}, ErrConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return Result{}, auth.ErrUnavailable
		}
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Result{}, auth.ErrUnavailable
	}
	for _, selected := range input.Selected {
		var accessible bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM message_events e WHERE e.id=$1 AND e.conversation=$2 AND e.redacted_at IS NULL AND (e.sender_id=$3 OR EXISTS(SELECT 1 FROM message_deliveries d WHERE d.event_id=e.id AND d.recipient_id=$3)))`, selected.EventID, input.Conversation, actor.AccountID).Scan(&accessible)
		if err != nil {
			return Result{}, auth.ErrUnavailable
		}
		if !accessible {
			return Result{}, ErrDenied
		}
	}
	now := s.now().UTC()
	selected, err := json.Marshal(input.Selected)
	if err != nil {
		return Result{}, ErrInvalid
	}
	result := Result{ID: "report-" + rand.Text(), OperationID: input.OperationID, ExpiresAt: now.Add(90 * 24 * time.Hour)}
	_, err = tx.Exec(ctx, `INSERT INTO user_reports(id,operation_id,reporter_id,subject_id,conversation,reason,details,selected_content,payload_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, result.ID, input.OperationID, actor.AccountID, input.SubjectID, input.Conversation, input.Reason, input.Details, selected, digest[:], now, result.ExpiresAt)
	if err != nil {
		return Result{}, auth.ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, auth.ErrUnavailable
	}
	return result, nil
}

func (s *Service) RunCleanup(ctx context.Context) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		cleanupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_, _ = s.pool.Exec(cleanupCtx, `WITH expired AS (SELECT ctid FROM user_reports WHERE expires_at <= now() LIMIT 1000) DELETE FROM user_reports WHERE ctid IN (SELECT ctid FROM expired)`)
		cancel()
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return
		}
	}
}
