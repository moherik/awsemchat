package messages

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

type CollectionSnapshot struct {
	ID    string                   `json:"id"`
	Part  int                      `json:"part"`
	Parts int                      `json:"parts"`
	Items []CollectionManifestItem `json:"items"`
}

func (s *CollectionSnapshot) UnmarshalJSON(raw []byte) error {
	var value struct {
		ID    string                   `json:"id"`
		Part  *int                     `json:"part"`
		Parts int                      `json:"parts"`
		Items []CollectionManifestItem `json:"items"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || !errors.Is(decoder.Decode(new(any)), io.EOF) || value.Part == nil {
		return ErrInvalid
	}
	*s = CollectionSnapshot{ID: value.ID, Part: *value.Part, Parts: value.Parts, Items: value.Items}
	return nil
}
func validSnapshot(value *CollectionSnapshot) bool {
	if value == nil || !identifier.MatchString(value.ID) || value.ID == "." || value.ID == ".." || value.Parts < 1 || value.Parts > 256 || value.Part < 0 || value.Part >= value.Parts || value.Items == nil || len(value.Items) > 50 || len(value.Items) == 0 && value.Parts != 1 {
		return false
	}
	previous := ""
	for _, item := range value.Items {
		if !identifier.MatchString(item.ID) || item.ID == "." || item.ID == ".." || item.ID <= previous || (item.Kind != "sticker" && item.Kind != "emoji") {
			return false
		}
		previous = item.ID
	}
	return true
}
func (s *Service) applyCollectionSnapshot(ctx context.Context, tx pgx.Tx, actor auth.Principal, circleID string, epoch, revision int64, operation string, part CollectionSnapshot) error {
	var admin bool
	var current, count int64
	if err := tx.QueryRow(ctx, "SELECT collection_revision FROM circles WHERE id=$1", circleID).Scan(&current); err != nil {
		return auth.ErrUnavailable
	}
	if current != revision {
		return ErrConflict
	}
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND role='admin' AND left_epoch IS NULL)", circleID, actor.AccountID).Scan(&admin); err != nil {
		return auth.ErrUnavailable
	}
	if !admin {
		return ErrDenied
	}
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM circle_collection_items WHERE circle_id=$1 AND removed_revision IS NULL", circleID).Scan(&count); err != nil {
		return auth.ErrUnavailable
	}
	if count == 0 && part.Parts != 1 || count > 0 && (int64(part.Parts) > count || count > int64(part.Parts*50)) {
		return ErrConflict
	}
	if _, err := tx.Exec(ctx, "INSERT INTO circle_collection_snapshots(circle_id,snapshot_id,sender_id,sender_generation,epoch,revision,parts) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(circle_id,snapshot_id) DO NOTHING", circleID, part.ID, actor.AccountID, actor.Generation, epoch, revision, part.Parts); err != nil {
		return auth.ErrUnavailable
	}
	var matches bool
	if err := tx.QueryRow(ctx, "SELECT sender_id=$3 AND sender_generation=$4 AND epoch=$5 AND revision=$6 AND parts=$7 FROM circle_collection_snapshots WHERE circle_id=$1 AND snapshot_id=$2", circleID, part.ID, actor.AccountID, actor.Generation, epoch, revision, part.Parts).Scan(&matches); err != nil {
		return auth.ErrUnavailable
	}
	if !matches {
		return ErrConflict
	}
	if len(part.Items) > 0 {
		var overlaps bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM circle_collection_snapshot_entries WHERE circle_id=$1 AND snapshot_id=$2 AND ((part<$3 AND item_id COLLATE "C">=$4) OR (part>$3 AND item_id COLLATE "C"<=$5)))`, circleID, part.ID, part.Part, part.Items[0].ID, part.Items[len(part.Items)-1].ID).Scan(&overlaps); err != nil {
			return auth.ErrUnavailable
		}
		if overlaps {
			return ErrConflict
		}
	}
	result, err := tx.Exec(ctx, "INSERT INTO circle_collection_snapshot_parts(circle_id,snapshot_id,part,operation_id) VALUES($1,$2,$3,$4) ON CONFLICT(circle_id,snapshot_id,part) DO NOTHING", circleID, part.ID, part.Part, operation)
	if err != nil {
		return auth.ErrUnavailable
	}
	if result.RowsAffected() != 1 {
		return ErrConflict
	}
	for _, item := range part.Items {
		inserted, err := tx.Exec(ctx, `INSERT INTO circle_collection_snapshot_entries(circle_id,snapshot_id,part,item_id,kind) SELECT $1,$2,$3,item_id,kind FROM circle_collection_items WHERE circle_id=$1 AND item_id=$4 AND kind=$5 AND removed_revision IS NULL ON CONFLICT(circle_id,snapshot_id,item_id) DO NOTHING`, circleID, part.ID, part.Part, item.ID, item.Kind)
		if err != nil {
			return auth.ErrUnavailable
		}
		if inserted.RowsAffected() != 1 {
			return ErrConflict
		}
	}
	var received, entries int64
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM circle_collection_snapshot_parts WHERE circle_id=$1 AND snapshot_id=$2", circleID, part.ID).Scan(&received); err != nil {
		return auth.ErrUnavailable
	}
	if received == int64(part.Parts) {
		if err = tx.QueryRow(ctx, "SELECT count(*) FROM circle_collection_snapshot_entries WHERE circle_id=$1 AND snapshot_id=$2", circleID, part.ID).Scan(&entries); err != nil {
			return auth.ErrUnavailable
		}
		if entries != count {
			return ErrConflict
		}
		if _, err = tx.Exec(ctx, "UPDATE circle_collection_snapshots SET completed_at=now() WHERE circle_id=$1 AND snapshot_id=$2", circleID, part.ID); err != nil {
			return auth.ErrUnavailable
		}
	}
	return nil
}
