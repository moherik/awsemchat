package messages

import (
	"context"
	"errors"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Acknowledge(ctx context.Context, actor auth.Principal, eventID string) error {
	if !identifier.MatchString(eventID) {
		return ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	// A lost acknowledgement may be retried after leaving; this grants no ciphertext access.
	result, err := tx.Exec(ctx, `UPDATE message_deliveries SET delivered_at=COALESCE(delivered_at,now()) WHERE event_id=$1 AND recipient_id=$2 AND recipient_generation=$3 AND EXISTS(SELECT 1 FROM message_events WHERE id=$1 AND redacted_at IS NULL)`, eventID, actor.AccountID, actor.Generation)
	if err != nil {
		return auth.ErrUnavailable
	}
	if result.RowsAffected() != 1 {
		return ErrDenied
	}
	if err = tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

func (s *Service) Status(ctx context.Context, actor auth.Principal, eventID string) (Event, error) {
	if !identifier.MatchString(eventID) {
		return Event{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Event{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return Event{}, err
	}
	result := Event{ID: eventID}
	err = tx.QueryRow(ctx, `SELECT e.operation_id, CASE WHEN e.redacted_at IS NOT NULL THEN 'redacted' WHEN (EXISTS(SELECT 1 FROM message_deliveries d WHERE d.event_id=e.id) OR e.envelope::jsonb->>'contentType' IN ('circle-profile','circle-collection','circle-collection-snapshot')) AND NOT EXISTS(SELECT 1 FROM message_deliveries d WHERE d.event_id=e.id AND d.delivered_at IS NULL) THEN 'delivered' ELSE 'sent' END FROM message_events e WHERE e.id=$1 AND e.sender_id=$2 AND e.sender_generation=$3`, eventID, actor.AccountID, actor.Generation).Scan(&result.Operation, &result.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrDenied
	}
	if err != nil {
		return Event{}, auth.ErrUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return Event{}, auth.ErrUnavailable
	}
	return result, nil
}
