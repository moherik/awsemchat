package messages

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/keys"
	"awsemchat/services/api/internal/operations"
	"github.com/jackc/pgx/v5"
)

var ErrCancelled = errors.New("message operation cancelled")

type ProfileCancellation struct {
	State     string `json:"state"`
	Operation string `json:"operation"`
	Event     *Event `json:"event,omitempty"`
}

func (s *Service) CancelProfile(ctx context.Context, actor auth.Principal, raw string) (ProfileCancellation, error) {
	return s.cancelOperation(ctx, actor, raw, "circle-profile")
}

func (s *Service) CancelCollection(ctx context.Context, actor auth.Principal, raw string) (ProfileCancellation, error) {
	return s.cancelOperation(ctx, actor, raw, "circle-collection")
}

func (s *Service) cancelOperation(ctx context.Context, actor auth.Principal, raw, contentType string) (ProfileCancellation, error) {
	envelope, err := DecodeEnvelope(raw)
	if err != nil {
		return ProfileCancellation{}, err
	}
	if envelope.ContentType != contentType || strings.HasPrefix(envelope.Conversation, "private:") {
		return ProfileCancellation{}, ErrDenied
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProfileCancellation{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	event, committed, err := s.operationState(ctx, tx, actor, envelope.Operation, raw)
	if err != nil && !errors.Is(err, ErrCancelled) {
		return ProfileCancellation{}, err
	}
	result := ProfileCancellation{State: "cancelled", Operation: envelope.Operation}
	if committed {
		result.State = "committed"
		result.Event = &event
	} else {
		identity, identityErr := keys.NewService(s.pool, s.auth).LockIdentity(ctx, tx, actor.AccountID)
		if identityErr != nil {
			return ProfileCancellation{}, identityErr
		}
		if envelope.Sender != (PeerKeys{Identity: identity.Identity, SigningIdentity: identity.SigningIdentity}) {
			return ProfileCancellation{}, ErrDenied
		}
		if err == nil {
			digest := sha256.Sum256([]byte(raw))
			if _, err := tx.Exec(ctx, "INSERT INTO profile_operation_cancellations(sender_id,sender_generation,operation_id,digest) VALUES($1,$2,$3,$4)", actor.AccountID, actor.Generation, envelope.Operation, digest[:]); err != nil {
				return ProfileCancellation{}, auth.ErrUnavailable
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ProfileCancellation{}, auth.ErrUnavailable
	}
	return result, nil
}

// The shared operation lock orders cancellation against the actual send commit.
func (s *Service) operationState(ctx context.Context, tx pgx.Tx, actor auth.Principal, operationID, raw string) (Event, bool, error) {
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Event{}, false, err
	}
	if err := operations.Lock(ctx, tx, actor.AccountID, actor.Generation, operationID); err != nil {
		return Event{}, false, auth.ErrUnavailable
	}
	digest := sha256.Sum256([]byte(raw))
	var saved []byte
	event := Event{Operation: operationID, Status: "sent"}
	var redacted bool
	err := tx.QueryRow(ctx, "SELECT id,digest,redacted_at IS NOT NULL FROM message_events WHERE sender_id=$1 AND sender_generation=$2 AND operation_id=$3", actor.AccountID, actor.Generation, operationID).Scan(&event.ID, &saved, &redacted)
	if err == nil {
		if string(saved) != string(digest[:]) {
			return Event{}, false, ErrConflict
		}
		if redacted {
			return Event{}, false, ErrRedacted
		}
		return event, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Event{}, false, auth.ErrUnavailable
	}
	var accountRedacted bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM message_events WHERE sender_id=$1 AND operation_id=$2 AND redacted_at IS NOT NULL)`, actor.AccountID, operationID).Scan(&accountRedacted); err != nil {
		return Event{}, false, auth.ErrUnavailable
	}
	if accountRedacted {
		return Event{}, false, ErrRedacted
	}
	err = tx.QueryRow(ctx, "SELECT digest FROM profile_operation_cancellations WHERE sender_id=$1 AND sender_generation=$2 AND operation_id=$3", actor.AccountID, actor.Generation, operationID).Scan(&saved)
	if err == nil {
		if string(saved) != string(digest[:]) {
			return Event{}, false, ErrConflict
		}
		return Event{}, false, ErrCancelled
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Event{}, false, auth.ErrUnavailable
	}
	var cancelled bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM message_operation_cancellations WHERE sender_id=$1 AND sender_generation=$2 AND operation_id=$3)", actor.AccountID, actor.Generation, operationID).Scan(&cancelled); err != nil {
		return Event{}, false, auth.ErrUnavailable
	}
	if cancelled {
		return Event{}, false, ErrCancelled
	}
	return Event{}, false, nil
}
