package push

import (
	"context"
	"errors"
	"regexp"
	"sort"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalid = errors.New("invalid notification device request")
var conversationID = regexp.MustCompile(`^(?:private:[a-f0-9]{64}|circle:[A-Za-z0-9._:-]{1,128})$`)

type DeviceService struct {
	pool *pgxpool.Pool
	auth *auth.Service
}

func NewDeviceService(pool *pgxpool.Pool, identity *auth.Service) *DeviceService {
	return &DeviceService{pool: pool, auth: identity}
}

func (s *DeviceService) Register(ctx context.Context, actor auth.Principal, token string, muted []string) error {
	if !validExpoToken(token) {
		return ErrInvalidToken
	}
	muted, err := validateMutedConversations(muted)
	if err != nil {
		return err
	}
	if s.pool == nil || s.auth == nil {
		return ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO notification_devices(account_id,generation,expo_token,muted_conversations,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(account_id) DO UPDATE SET generation=EXCLUDED.generation,expo_token=EXCLUDED.expo_token,muted_conversations=EXCLUDED.muted_conversations,updated_at=now()`, actor.AccountID, actor.Generation, token, muted); err != nil {
		return auth.ErrUnavailable
	}
	if _, err = tx.Exec(ctx, `DELETE FROM notification_outbox o USING message_events e WHERE e.id=o.event_id AND o.account_id=$1 AND (o.generation<>$2 OR e.conversation=ANY($3))`, actor.AccountID, actor.Generation, muted); err != nil {
		return auth.ErrUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

func validateMutedConversations(values []string) ([]string, error) {
	if len(values) > 1000 {
		return nil, ErrInvalid
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !conversationID.MatchString(value) {
			return nil, ErrInvalid
		}
		seen[value] = struct{}{}
	}
	result := make([]string, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result, nil
}

func (s *DeviceService) Unregister(ctx context.Context, actor auth.Principal) error {
	if s.pool == nil || s.auth == nil {
		return ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM notification_outbox WHERE account_id=$1`, actor.AccountID); err != nil {
		return auth.ErrUnavailable
	}
	if _, err = tx.Exec(ctx, `DELETE FROM notification_devices WHERE account_id=$1 AND generation=$2`, actor.AccountID, actor.Generation); err != nil {
		return auth.ErrUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

func (s *DeviceService) UpdatePreferences(ctx context.Context, actor auth.Principal, muted []string) error {
	muted, err := validateMutedConversations(muted)
	if err != nil {
		return err
	}
	if s.pool == nil || s.auth == nil {
		return ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `UPDATE notification_devices SET muted_conversations=$3,updated_at=now() WHERE account_id=$1 AND generation=$2`, actor.AccountID, actor.Generation, muted)
	if err != nil {
		return auth.ErrUnavailable
	}
	if result.RowsAffected() != 1 {
		if err = tx.Commit(ctx); err != nil {
			return auth.ErrUnavailable
		}
		return nil
	}
	if _, err = tx.Exec(ctx, `DELETE FROM notification_outbox o USING message_events e WHERE e.id=o.event_id AND o.account_id=$1 AND o.generation=$2 AND e.conversation=ANY($3)`, actor.AccountID, actor.Generation, muted); err != nil {
		return auth.ErrUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

func (s *DeviceService) Status(ctx context.Context, actor auth.Principal) (bool, error) {
	if s.pool == nil || s.auth == nil {
		return false, ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return false, err
	}
	var registered bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM notification_devices WHERE account_id=$1 AND generation=$2)`, actor.AccountID, actor.Generation).Scan(&registered); err != nil {
		return false, auth.ErrUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return false, auth.ErrUnavailable
	}
	return registered, nil
}
