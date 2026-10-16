package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"strings"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
	"awsemchat/services/api/internal/messages"
	"awsemchat/services/api/internal/operations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrDenied = errors.New("media access denied")
var ErrOperationCancelled = errors.New("media operation cancelled")

type Storage interface {
	Put(context.Context, string, []byte) error
	Get(context.Context, string) ([]byte, error)
	Delete(context.Context, string) error
}

type OperationCancellation struct {
	State   string `json:"state"`
	EventID string `json:"eventId,omitempty"`
}

type Service struct {
	pool    *pgxpool.Pool
	circles *circles.Service
	storage Storage
	auth    *auth.Service
}

func NewService(pool *pgxpool.Pool, identity *auth.Service, storage Storage) *Service {
	return &Service{pool: pool, circles: circles.NewService(pool, identity), storage: storage, auth: identity}
}

func (s *Service) PutCircle(ctx context.Context, actor auth.Principal, circleID string, epoch int64, id, operationID string, ciphertext []byte) error {
	if !objectID.MatchString(id) || !objectID.MatchString(circleID) || !objectID.MatchString(operationID) || epoch < 1 || epoch > 9007199254740991 || len(ciphertext) < 1 || len(ciphertext) > maxCiphertext {
		return ErrInvalid
	}
	body := bytes.Clone(ciphertext)
	digest := sha256.Sum256(body)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	if err := operations.Lock(ctx, tx, actor.AccountID, actor.Generation, operationID); err != nil {
		return auth.ErrUnavailable
	}
	var cancelled bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM message_operation_cancellations WHERE sender_id=$1 AND sender_generation=$2 AND operation_id=$3)", actor.AccountID, actor.Generation, operationID).Scan(&cancelled); err != nil {
		return auth.ErrUnavailable
	}
	if cancelled {
		return ErrOperationCancelled
	}
	audience, err := s.circles.CurrentAudience(ctx, tx, actor, circleID)
	if err != nil {
		return mediaAccessError(err)
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "media:"+id); err != nil {
		return auth.ErrUnavailable
	}
	var privateID bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM private_media_objects WHERE id=$1)", id).Scan(&privateID); err != nil {
		return auth.ErrUnavailable
	}
	if privateID {
		return ErrConflict
	}
	var privateOperation bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM private_media_objects WHERE owner_id=$1 AND owner_generation=$2 AND operation_id=$3)", actor.AccountID, actor.Generation, operationID).Scan(&privateOperation); err != nil {
		return auth.ErrUnavailable
	}
	if privateOperation {
		return ErrConflict
	}
	var existingCircle, owner string
	var existingEpoch int64
	var existingDigest []byte
	var size int
	var existingGeneration pgtype.Int8
	var existingOperation *string
	err = tx.QueryRow(ctx, "SELECT circle_id,owner_id,owner_generation,operation_id,epoch,ciphertext_digest,ciphertext_size FROM circle_media_objects WHERE id=$1", id).Scan(&existingCircle, &owner, &existingGeneration, &existingOperation, &existingEpoch, &existingDigest, &size)
	switch {
	case err == nil:
		if existingCircle != circleID || owner != actor.AccountID || !existingGeneration.Valid || existingGeneration.Int64 != actor.Generation || existingOperation == nil || *existingOperation != operationID {
			return ErrDenied
		}
		if existingEpoch != epoch || size != len(body) || !bytes.Equal(existingDigest, digest[:]) {
			return ErrConflict
		}
		if err := requireGrant(ctx, tx, id, actor.AccountID); err != nil {
			return err
		}
	case errors.Is(err, pgx.ErrNoRows):
		if audience.Epoch != epoch {
			return ErrDenied
		}
		var otherCircle string
		if err := tx.QueryRow(ctx, "SELECT circle_id FROM circle_media_objects WHERE owner_id=$1 AND owner_generation=$2 AND operation_id=$3 LIMIT 1", actor.AccountID, actor.Generation, operationID).Scan(&otherCircle); err == nil && otherCircle != circleID {
			return ErrConflict
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return auth.ErrUnavailable
		}
		if _, err := tx.Exec(ctx, "INSERT INTO circle_media_objects(id,circle_id,owner_id,owner_generation,operation_id,epoch,ciphertext_digest,ciphertext_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", id, circleID, actor.AccountID, actor.Generation, operationID, epoch, digest[:], len(body)); err != nil {
			return auth.ErrUnavailable
		}
		for _, member := range audience.Members {
			if _, err := tx.Exec(ctx, "INSERT INTO circle_media_grants(object_id,circle_id,interval_id,account_id) VALUES($1,$2,$3,$4)", id, circleID, member.IntervalID, member.AccountID); err != nil {
				return auth.ErrUnavailable
			}
		}
	default:
		return auth.ErrUnavailable
	}
	if err := s.storage.Put(ctx, id, body); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

// PutPrivate stores opaque ciphertext for the exact currently accepted friendship audience.
func (s *Service) PutPrivate(ctx context.Context, actor auth.Principal, peerID, audience, id, operationID string, ciphertext []byte) error {
	if !objectID.MatchString(id) || !objectID.MatchString(operationID) || len(ciphertext) < 1 || len(ciphertext) > maxCiphertext {
		return ErrInvalid
	}
	body := bytes.Clone(ciphertext)
	digest := sha256.Sum256(body)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	if err := operations.Lock(ctx, tx, actor.AccountID, actor.Generation, operationID); err != nil {
		return auth.ErrUnavailable
	}
	var cancelled bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM message_operation_cancellations WHERE sender_id=$1 AND sender_generation=$2 AND operation_id=$3)", actor.AccountID, actor.Generation, operationID).Scan(&cancelled); err != nil {
		return auth.ErrUnavailable
	}
	if cancelled {
		return ErrOperationCancelled
	}
	conversation, err := s.privateAudience(ctx, tx, actor, peerID, audience)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "media:"+id); err != nil {
		return auth.ErrUnavailable
	}
	var circleID bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_media_objects WHERE id=$1)", id).Scan(&circleID); err != nil {
		return auth.ErrUnavailable
	}
	if circleID {
		return ErrConflict
	}
	var circleOperation bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_media_objects WHERE owner_id=$1 AND owner_generation=$2 AND operation_id=$3)", actor.AccountID, actor.Generation, operationID).Scan(&circleOperation); err != nil {
		return auth.ErrUnavailable
	}
	if circleOperation {
		return ErrConflict
	}
	var existingConversation, existingAudience, owner, existingPeer, existingOperation string
	var existingGeneration int64
	var existingDigest []byte
	var size int
	err = tx.QueryRow(ctx, "SELECT conversation,audience,owner_id,peer_id,owner_generation,operation_id,ciphertext_digest,ciphertext_size FROM private_media_objects WHERE id=$1", id).Scan(&existingConversation, &existingAudience, &owner, &existingPeer, &existingGeneration, &existingOperation, &existingDigest, &size)
	switch {
	case err == nil:
		if existingConversation != conversation || existingAudience != audience || owner != actor.AccountID || existingPeer != peerID || existingGeneration != actor.Generation || existingOperation != operationID {
			return ErrDenied
		}
		if size != len(body) || !bytes.Equal(existingDigest, digest[:]) {
			return ErrConflict
		}
	case errors.Is(err, pgx.ErrNoRows):
		var otherOperation bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM private_media_objects WHERE owner_id=$1 AND owner_generation=$2 AND operation_id=$3)", actor.AccountID, actor.Generation, operationID).Scan(&otherOperation); err != nil {
			return auth.ErrUnavailable
		}
		if otherOperation {
			return ErrConflict
		}
		if _, err := tx.Exec(ctx, "INSERT INTO private_media_objects(id,conversation,audience,owner_id,peer_id,owner_generation,operation_id,ciphertext_digest,ciphertext_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", id, conversation, audience, actor.AccountID, peerID, actor.Generation, operationID, digest[:], len(body)); err != nil {
			return auth.ErrUnavailable
		}
	default:
		return auth.ErrUnavailable
	}
	if err := s.storage.Put(ctx, id, body); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

// GetPrivate returns ciphertext only while the exact friendship audience is active.
func (s *Service) GetPrivate(ctx context.Context, actor auth.Principal, peerID, audience, id string) ([]byte, error) {
	if !objectID.MatchString(id) {
		return nil, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return nil, err
	}
	conversation, err := s.privateAudience(ctx, tx, actor, peerID, audience)
	if err != nil {
		return nil, err
	}
	var owner, recipient string
	var digest []byte
	var size int
	err = tx.QueryRow(ctx, `SELECT owner_id,peer_id,ciphertext_digest,ciphertext_size FROM private_media_objects o WHERE id=$1 AND conversation=$2 AND audience=$3 AND (owner_id=$4 OR peer_id=$4) AND NOT EXISTS(SELECT 1 FROM private_media_cleanup c WHERE c.object_id=o.id) AND NOT EXISTS(SELECT 1 FROM message_events e WHERE e.sender_id=o.owner_id AND e.operation_id=o.operation_id AND e.conversation=o.conversation AND e.audience=o.audience AND e.redacted_at IS NOT NULL)`, id, conversation, audience, actor.AccountID).Scan(&owner, &recipient, &digest, &size)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrDenied
	}
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	if actor.AccountID != owner && actor.AccountID != recipient {
		return nil, ErrDenied
	}
	body, err := s.storage.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	actual := sha256.Sum256(body)
	if len(body) != size || !bytes.Equal(actual[:], digest) {
		return nil, auth.ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, auth.ErrUnavailable
	}
	return body, nil
}

// CancelPrivateOperation fences a private send and queues only its unused media.
func (s *Service) CancelPrivateOperation(ctx context.Context, actor auth.Principal, peerID, audience, operationID string) (OperationCancellation, error) {
	if !objectID.MatchString(peerID) || peerID == actor.AccountID || !objectID.MatchString(operationID) || !strings.HasPrefix(audience, "friend:") || !objectID.MatchString(strings.TrimPrefix(audience, "friend:")) {
		return OperationCancellation{}, ErrInvalid
	}
	conversation := messages.PrivateConversationID(actor.AccountID, peerID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OperationCancellation{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return OperationCancellation{}, err
	}
	if err := operations.Lock(ctx, tx, actor.AccountID, actor.Generation, operationID); err != nil {
		return OperationCancellation{}, auth.ErrUnavailable
	}
	result := OperationCancellation{State: "cancelled"}
	var eventConversation, eventAudience string
	err = tx.QueryRow(ctx, "SELECT id,conversation,audience FROM message_events WHERE sender_id=$1 AND sender_generation=$2 AND operation_id=$3", actor.AccountID, actor.Generation, operationID).Scan(&result.EventID, &eventConversation, &eventAudience)
	if err == nil {
		if eventConversation != conversation || eventAudience != audience {
			return OperationCancellation{}, ErrConflict
		}
		result.State = "committed"
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return OperationCancellation{}, auth.ErrUnavailable
	} else {
		var objectConversation, objectAudience, objectPeer string
		objectErr := tx.QueryRow(ctx, "SELECT conversation,audience,peer_id FROM private_media_objects WHERE owner_id=$1 AND owner_generation=$2 AND operation_id=$3", actor.AccountID, actor.Generation, operationID).Scan(&objectConversation, &objectAudience, &objectPeer)
		if objectErr == nil && (objectConversation != conversation || objectAudience != audience || objectPeer != peerID) {
			return OperationCancellation{}, ErrConflict
		}
		if objectErr != nil && !errors.Is(objectErr, pgx.ErrNoRows) {
			return OperationCancellation{}, auth.ErrUnavailable
		}
		if _, err := tx.Exec(ctx, "INSERT INTO message_operation_cancellations(sender_id,sender_generation,operation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", actor.AccountID, actor.Generation, operationID); err != nil {
			return OperationCancellation{}, auth.ErrUnavailable
		}
		if _, err := tx.Exec(ctx, `INSERT INTO private_media_cleanup(object_id,owner_id,owner_generation,operation_id) SELECT id,owner_id,owner_generation,operation_id FROM private_media_objects WHERE conversation=$1 AND audience=$2 AND peer_id=$3 AND owner_id=$4 AND owner_generation=$5 AND operation_id=$6 ON CONFLICT(object_id) DO NOTHING`, conversation, audience, peerID, actor.AccountID, actor.Generation, operationID); err != nil {
			return OperationCancellation{}, auth.ErrUnavailable
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return OperationCancellation{}, auth.ErrUnavailable
	}
	return result, nil
}

func (s *Service) privateAudience(ctx context.Context, tx pgx.Tx, actor auth.Principal, peerID, audience string) (string, error) {
	if !objectID.MatchString(peerID) || peerID == actor.AccountID || !strings.HasPrefix(audience, "friend:") || !objectID.MatchString(strings.TrimPrefix(audience, "friend:")) {
		return "", ErrInvalid
	}
	request, err := friends.NewService(s.pool, s.auth).AcceptedRequest(ctx, tx, actor, peerID)
	if errors.Is(err, friends.ErrDenied) {
		return "", ErrDenied
	}
	if err != nil {
		return "", err
	}
	if audience != "friend:"+request {
		return "", ErrDenied
	}
	return messages.PrivateConversationID(actor.AccountID, peerID), nil
}

func (s *Service) CancelOperation(ctx context.Context, actor auth.Principal, circleID, operationID string) (OperationCancellation, error) {
	if !objectID.MatchString(circleID) || !objectID.MatchString(operationID) {
		return OperationCancellation{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OperationCancellation{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return OperationCancellation{}, err
	}
	if err := operations.Lock(ctx, tx, actor.AccountID, actor.Generation, operationID); err != nil {
		return OperationCancellation{}, auth.ErrUnavailable
	}
	result := OperationCancellation{State: "cancelled"}
	var eventCircle string
	err = tx.QueryRow(ctx, "SELECT id,circle_id FROM message_events WHERE sender_id=$1 AND sender_generation=$2 AND operation_id=$3", actor.AccountID, actor.Generation, operationID).Scan(&result.EventID, &eventCircle)
	if err == nil {
		if eventCircle != circleID {
			return OperationCancellation{}, ErrConflict
		}
		result.State = "committed"
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return OperationCancellation{}, auth.ErrUnavailable
	} else {
		if _, err := tx.Exec(ctx, "INSERT INTO message_operation_cancellations(sender_id,sender_generation,operation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", actor.AccountID, actor.Generation, operationID); err != nil {
			return OperationCancellation{}, auth.ErrUnavailable
		}
		if _, err := tx.Exec(ctx, `INSERT INTO circle_media_cleanup(object_id,circle_id,owner_id,owner_generation,operation_id) SELECT id,circle_id,owner_id,owner_generation,operation_id FROM circle_media_objects WHERE circle_id=$1 AND owner_id=$2 AND owner_generation=$3 AND operation_id=$4 ON CONFLICT(object_id) DO NOTHING`, circleID, actor.AccountID, actor.Generation, operationID); err != nil {
			return OperationCancellation{}, auth.ErrUnavailable
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return OperationCancellation{}, auth.ErrUnavailable
	}
	return result, nil
}

func (s *Service) GetCircle(ctx context.Context, actor auth.Principal, circleID, id string) ([]byte, error) {
	if !objectID.MatchString(id) || !objectID.MatchString(circleID) {
		return nil, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if _, err := s.circles.CurrentAudience(ctx, tx, actor, circleID); err != nil {
		return nil, mediaAccessError(err)
	}
	var digest []byte
	var size int
	err = tx.QueryRow(ctx, `SELECT ciphertext_digest,ciphertext_size FROM circle_media_objects o WHERE id=$1 AND circle_id=$2 AND NOT EXISTS(SELECT 1 FROM circle_media_cleanup c WHERE c.object_id=o.id) AND NOT EXISTS(SELECT 1 FROM message_events e WHERE e.sender_id=o.owner_id AND e.operation_id=o.operation_id AND e.circle_id=o.circle_id AND e.redacted_at IS NOT NULL)`, id, circleID).Scan(&digest, &size)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrDenied
	}
	if err != nil {
		return nil, auth.ErrUnavailable
	}
	if err := requireGrant(ctx, tx, id, actor.AccountID); err != nil {
		return nil, err
	}
	body, err := s.storage.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	actual := sha256.Sum256(body)
	if len(body) != size || !bytes.Equal(actual[:], digest) {
		return nil, auth.ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, auth.ErrUnavailable
	}
	return body, nil
}

func requireGrant(ctx context.Context, tx pgx.Tx, id, account string) error {
	var allowed bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM circle_media_grants g JOIN circle_memberships m ON m.id=g.interval_id WHERE g.object_id=$1 AND g.account_id=$2 AND m.left_epoch IS NULL)`, id, account).Scan(&allowed)
	if err != nil {
		return auth.ErrUnavailable
	}
	if !allowed {
		return ErrDenied
	}
	return nil
}

func mediaAccessError(err error) error {
	if errors.Is(err, circles.ErrDenied) {
		return ErrDenied
	}
	return err
}
