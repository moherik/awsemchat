package messages

import (
	"context"
	"errors"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
)

type CollectionManifestInput struct {
	CircleID string `json:"circleId"`
	Epoch    int64  `json:"epoch"`
	Revision int64  `json:"revision"`
	Cursor   string `json:"cursor"`
	Limit    int    `json:"limit"`
}
type CollectionManifestItem struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}
type CollectionManifest struct {
	CircleID string                   `json:"circleId"`
	Epoch    int64                    `json:"epoch"`
	Revision int64                    `json:"revision"`
	Items    []CollectionManifestItem `json:"items"`
	Cursor   string                   `json:"cursor,omitempty"`
	More     bool                     `json:"more"`
}

func (s *Service) CollectionManifest(ctx context.Context, actor auth.Principal, input CollectionManifestInput) (CollectionManifest, error) {
	if !identifier.MatchString(input.CircleID) || input.CircleID == "." || input.CircleID == ".." || input.Epoch < 1 || input.Epoch > 9007199254740991 || input.Revision < 0 || input.Revision > 9007199254740991 || input.Limit < 1 || input.Limit > 50 || (input.Cursor != "" && (!identifier.MatchString(input.Cursor) || input.Cursor == "." || input.Cursor == "..")) {
		return CollectionManifest{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CollectionManifest{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	audience, err := circles.NewService(s.pool, s.auth).CurrentAudience(ctx, tx, actor, input.CircleID)
	if err != nil {
		if errors.Is(err, circles.ErrDenied) {
			return CollectionManifest{}, ErrDenied
		}
		return CollectionManifest{}, err
	}
	var revision int64
	if err = tx.QueryRow(ctx, "SELECT collection_revision FROM circles WHERE id=$1", input.CircleID).Scan(&revision); err != nil {
		return CollectionManifest{}, auth.ErrUnavailable
	}
	if audience.Epoch != input.Epoch || revision != input.Revision {
		return CollectionManifest{}, ErrConflict
	}
	if input.Cursor != "" {
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_collection_items WHERE circle_id=$1 AND item_id=$2 AND removed_revision IS NULL)", input.CircleID, input.Cursor).Scan(&exists); err != nil {
			return CollectionManifest{}, auth.ErrUnavailable
		}
		if !exists {
			return CollectionManifest{}, ErrInvalid
		}
	}
	rows, err := tx.Query(ctx, `SELECT item_id,kind FROM circle_collection_items WHERE circle_id=$1 AND removed_revision IS NULL AND item_id COLLATE "C">$2 ORDER BY item_id COLLATE "C" LIMIT $3`, input.CircleID, input.Cursor, input.Limit+1)
	if err != nil {
		return CollectionManifest{}, auth.ErrUnavailable
	}
	defer rows.Close()
	result := CollectionManifest{CircleID: input.CircleID, Epoch: audience.Epoch, Revision: revision, Items: []CollectionManifestItem{}}
	for rows.Next() {
		var item CollectionManifestItem
		if rows.Scan(&item.ID, &item.Kind) != nil {
			return CollectionManifest{}, auth.ErrUnavailable
		}
		result.Items = append(result.Items, item)
	}
	if rows.Err() != nil {
		return CollectionManifest{}, auth.ErrUnavailable
	}
	rows.Close()
	if len(result.Items) > input.Limit {
		result.More = true
		result.Items = result.Items[:input.Limit]
		result.Cursor = result.Items[len(result.Items)-1].ID
	}
	if err = tx.Commit(ctx); err != nil {
		return CollectionManifest{}, auth.ErrUnavailable
	}
	return result, nil
}
