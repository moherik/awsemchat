package keys

import (
	"context"
	"errors"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

type PublishedIdentity struct {
	Generation      int64
	Identity        string
	SigningIdentity string
}

// LockIdentity keeps a published generation stable for the caller's authorized transaction.
func (s *Service) LockIdentity(ctx context.Context, tx pgx.Tx, accountID string) (PublishedIdentity, error) {
	result := PublishedIdentity{}
	if tx == nil || !publicationPattern.MatchString(accountID) {
		return result, ErrInvalid
	}
	err := tx.QueryRow(ctx, "SELECT generation FROM auth_accounts WHERE id=$1 FOR SHARE", accountID).Scan(&result.Generation)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrExhausted
	}
	if err != nil {
		return result, auth.ErrUnavailable
	}
	err = tx.QueryRow(ctx, "SELECT identity,signing_identity FROM key_identities WHERE account_id=$1 AND generation=$2 FOR SHARE", accountID, result.Generation).Scan(&result.Identity, &result.SigningIdentity)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrExhausted
	}
	if err != nil {
		return result, auth.ErrUnavailable
	}
	return result, nil
}
