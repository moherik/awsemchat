package circles

import (
	"context"
	"errors"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

type AudienceMember struct {
	AccountID  string
	IntervalID string
}
type CurrentAudience struct {
	Epoch   int64
	Members []AudienceMember
}

func (s *Service) CurrentAudience(ctx context.Context, tx pgx.Tx, actor auth.Principal, circleID string) (CurrentAudience, error) {
	result := CurrentAudience{Members: []AudienceMember{}}
	if tx == nil || !idPattern.MatchString(circleID) {
		return result, ErrDenied
	}
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return result, err
	}
	var closed bool
	err := tx.QueryRow(ctx, "SELECT epoch,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR SHARE", circleID).Scan(&result.Epoch, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrDenied
	}
	if err != nil {
		return result, auth.ErrUnavailable
	}
	if closed {
		return result, ErrDenied
	}
	rows, err := tx.Query(ctx, "SELECT account_id,id FROM circle_memberships WHERE circle_id=$1 AND left_epoch IS NULL ORDER BY account_id", circleID)
	if err != nil {
		return result, auth.ErrUnavailable
	}
	defer rows.Close()
	member := false
	for rows.Next() {
		var m AudienceMember
		if rows.Scan(&m.AccountID, &m.IntervalID) != nil {
			return result, auth.ErrUnavailable
		}
		if m.AccountID == actor.AccountID {
			member = true
		}
		result.Members = append(result.Members, m)
	}
	if rows.Err() != nil || len(result.Members) > 20 {
		return result, auth.ErrUnavailable
	}
	if !member {
		return result, ErrDenied
	}
	return result, nil
}

// RequireAudience holds the membership epoch stable until the caller commits its transaction.
func (s *Service) RequireAudience(ctx context.Context, tx pgx.Tx, actor auth.Principal, circleID, targetID string, epoch int64) error {
	if tx == nil || !idPattern.MatchString(circleID) || !idPattern.MatchString(targetID) || epoch < 1 {
		return ErrDenied
	}
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	var current int64
	var closed bool
	err := tx.QueryRow(ctx, "SELECT epoch,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR SHARE", circleID).Scan(&current, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	if closed || current != epoch {
		return ErrDenied
	}
	var count int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM circle_memberships WHERE circle_id=$1 AND account_id IN ($2,$3) AND left_epoch IS NULL AND joined_epoch<=$4`, circleID, actor.AccountID, targetID, epoch).Scan(&count)
	if err != nil {
		return auth.ErrUnavailable
	}
	if actor.AccountID == targetID || count != 2 {
		return ErrDenied
	}
	return nil
}
