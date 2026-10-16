package keys

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"time"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
	"github.com/jackc/pgx/v5"
)

var ErrDenied = errors.New("key allocation denied")
var ErrExhausted = errors.New("key pool exhausted")

type AllocationRequest struct {
	OperationID string `json:"operationId"`
	TargetID    string `json:"targetId"`
	CircleID    string `json:"circleId,omitempty"`
	Epoch       int64  `json:"epoch,omitempty"`
}
type Allocation struct {
	Generation int64  `json:"generation"`
	Bundle     Bundle `json:"bundle"`
}

func (s *Service) Allocate(ctx context.Context, actor auth.Principal, input AllocationRequest, now time.Time) (Allocation, error) {
	result := Allocation{}
	if !publicationPattern.MatchString(input.OperationID) || !publicationPattern.MatchString(input.TargetID) || input.TargetID == actor.AccountID {
		return result, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if input.CircleID == "" {
		if input.Epoch != 0 {
			return result, ErrInvalid
		}
		err = friends.NewService(s.pool, s.auth).RequireAccepted(ctx, tx, actor, input.TargetID)
	} else {
		err = circles.NewService(s.pool, s.auth).RequireAudience(ctx, tx, actor, input.CircleID, input.TargetID, input.Epoch)
	}
	if err != nil {
		if errors.Is(err, friends.ErrDenied) || errors.Is(err, circles.ErrDenied) {
			return result, ErrDenied
		}
		return result, err
	}
	err = tx.QueryRow(ctx, "SELECT generation FROM auth_accounts WHERE id=$1 FOR SHARE", input.TargetID).Scan(&result.Generation)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrDenied
	}
	if err != nil {
		return result, auth.ErrUnavailable
	}
	digest := sha256.Sum256([]byte("awsemchat.key-allocation\x00" + actor.AccountID + "\x00" + input.OperationID))
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(binary.BigEndian.Uint64(digest[:8]))); err != nil {
		return result, auth.ErrUnavailable
	}
	var target, circle, key string
	var generation, epoch int64
	err = tx.QueryRow(ctx, `SELECT target_id,target_generation,circle_id,epoch,key_id FROM key_allocations WHERE actor_id=$1 AND actor_generation=$2 AND operation_id=$3`, actor.AccountID, actor.Generation, input.OperationID).Scan(&target, &generation, &circle, &epoch, &key)
	var raw []byte
	if err == nil {
		if target != input.TargetID || generation != result.Generation || circle != input.CircleID || epoch != input.Epoch {
			return result, ErrConflict
		}
		err = tx.QueryRow(ctx, `SELECT bundle FROM key_prekeys WHERE account_id=$1 AND generation=$2 AND key_id=$3`, target, generation, key).Scan(&raw)
	} else if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `SELECT key_id,bundle FROM key_prekeys WHERE account_id=$1 AND generation=$2 AND allocated=false AND expires_at>$3 ORDER BY key_id LIMIT 1 FOR UPDATE SKIP LOCKED`, input.TargetID, result.Generation, now).Scan(&key, &raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, ErrExhausted
		}
		if err != nil {
			return result, auth.ErrUnavailable
		}
		if _, err = tx.Exec(ctx, `UPDATE key_prekeys SET allocated=true WHERE account_id=$1 AND generation=$2 AND key_id=$3`, input.TargetID, result.Generation, key); err != nil {
			return result, auth.ErrUnavailable
		}
		_, err = tx.Exec(ctx, `INSERT INTO key_allocations(actor_id,actor_generation,operation_id,target_id,target_generation,circle_id,epoch,key_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, actor.AccountID, actor.Generation, input.OperationID, input.TargetID, result.Generation, input.CircleID, input.Epoch, key)
	}
	if err != nil {
		return result, auth.ErrUnavailable
	}
	if json.Unmarshal(raw, &result.Bundle) != nil {
		return result, auth.ErrUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return result, auth.ErrUnavailable
	}
	return result, nil
}
