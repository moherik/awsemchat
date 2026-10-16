package keys

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrConflict = errors.New("key publication conflict")

type Service struct {
	pool *pgxpool.Pool
	auth *auth.Service
}

func NewService(pool *pgxpool.Pool, identity *auth.Service) *Service {
	return &Service{pool: pool, auth: identity}
}
func (s *Service) Publish(ctx context.Context, actor auth.Principal, registration Registration, now time.Time) error {
	if len(registration.Bundles) == 0 {
		return ErrInvalid
	}
	first := registration.Bundles[0]
	// Verify signatures even for expired retries; only committed identical batches bypass current expiry.
	if err := registration.Validate(actor, time.Unix(first.IssuedAt, 0)); err != nil {
		return err
	}
	raw, err := json.Marshal(registration)
	if err != nil {
		return ErrInvalid
	}
	digest := sha256.Sum256(raw)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO key_identities(account_id,generation,device_id,identity,signing_identity) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, actor.AccountID, actor.Generation, actor.DeviceID, first.Identity, first.SigningIdentity)
	if err != nil {
		return auth.ErrUnavailable
	}
	var device, identity, signing string
	err = tx.QueryRow(ctx, `SELECT device_id,identity,signing_identity FROM key_identities WHERE account_id=$1 AND generation=$2 FOR UPDATE`, actor.AccountID, actor.Generation).Scan(&device, &identity, &signing)
	if err != nil {
		return auth.ErrUnavailable
	}
	if device != actor.DeviceID || identity != first.Identity || signing != first.SigningIdentity {
		return ErrConflict
	}
	var saved []byte
	err = tx.QueryRow(ctx, `SELECT digest FROM key_publications WHERE account_id=$1 AND generation=$2 AND operation_id=$3`, actor.AccountID, actor.Generation, first.Publication).Scan(&saved)
	if err == nil {
		if !bytes.Equal(saved, digest[:]) {
			return ErrConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return auth.ErrUnavailable
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return auth.ErrUnavailable
	}
	if err = registration.Validate(actor, now); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO key_publications(account_id,generation,operation_id,digest) VALUES($1,$2,$3,$4)`, actor.AccountID, actor.Generation, first.Publication, digest[:])
	if err != nil {
		return auth.ErrUnavailable
	}
	for _, bundle := range registration.Bundles {
		raw, err := json.Marshal(bundle)
		if err != nil {
			return ErrInvalid
		}
		result, err := tx.Exec(ctx, `INSERT INTO key_prekeys(account_id,generation,operation_id,key_id,prekey,bundle,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, actor.AccountID, actor.Generation, first.Publication, bundle.KeyID, bundle.Prekey, raw, time.Unix(bundle.ExpiresAt, 0))
		if err != nil {
			return auth.ErrUnavailable
		}
		if result.RowsAffected() != 1 {
			return ErrConflict
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}
