package messages

import (
	"context"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

func (s *Service) applyCollectionChange(ctx context.Context, tx pgx.Tx, actor auth.Principal, circleID string, revision int64, change CollectionChange) error {
	if change.Action == "remove" {
		var admin bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND role='admin' AND left_epoch IS NULL)", circleID, actor.AccountID).Scan(&admin); err != nil {
			return auth.ErrUnavailable
		}
		if !admin {
			return ErrDenied
		}
	}
	updated, err := tx.Exec(ctx, "UPDATE circles SET collection_revision=$1 WHERE id=$2 AND collection_revision=$1-1", revision, circleID)
	if err != nil {
		return auth.ErrUnavailable
	}
	if updated.RowsAffected() != 1 {
		return ErrConflict
	}
	if change.Action == "add" {
		created, err := tx.Exec(ctx, "INSERT INTO circle_collection_items(circle_id,item_id,kind,contributor_id,added_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(circle_id,item_id) DO NOTHING", circleID, change.Item, change.Kind, actor.AccountID, revision)
		if err != nil {
			return auth.ErrUnavailable
		}
		if created.RowsAffected() != 1 {
			return ErrConflict
		}
		return nil
	}
	removed, err := tx.Exec(ctx, "UPDATE circle_collection_items SET removed_revision=$1 WHERE circle_id=$2 AND item_id=$3 AND kind=$4 AND removed_revision IS NULL", revision, circleID, change.Item, change.Kind)
	if err != nil {
		return auth.ErrUnavailable
	}
	if removed.RowsAffected() != 1 {
		return ErrConflict
	}
	return nil
}
