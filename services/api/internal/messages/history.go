package messages

import (
	"context"
	"encoding/json"
	"errors"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

// History returns older ciphertext already addressed to the active device generation.
func (s *Service) History(ctx context.Context, actor auth.Principal, conversation, audience, cursor string, limit int) (InboxPage, error) {
	page := InboxPage{Items: []Delivery{}}
	if !identifier.MatchString(conversation) || !identifier.MatchString(audience) ||
		(limit < 1 || limit > 25) || (cursor != "" && !identifier.MatchString(cursor)) {
		return page, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return page, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return page, err
	}
	var before int64
	if cursor != "" {
		err = tx.QueryRow(ctx, `SELECT d.sequence FROM message_deliveries d JOIN message_events e ON e.id=d.event_id WHERE d.event_id=$1 AND d.recipient_id=$2 AND d.recipient_generation=$3 AND e.conversation=$4 AND e.audience=$5`, cursor, actor.AccountID, actor.Generation, conversation, audience).Scan(&before)
		if errors.Is(err, pgx.ErrNoRows) {
			return page, ErrInvalid
		}
		if err != nil {
			return page, auth.ErrUnavailable
		}
	}
	rows, err := tx.Query(ctx, `SELECT d.event_id,e.operation_id,e.conversation,e.audience,e.sender_id,e.sender_generation,e.envelope::jsonb->'sender',d.public_keys,d.ciphertext,e.circle_id,d.membership_interval,COALESCE(e.envelope::jsonb->>'contentType',''),(e.envelope::jsonb->>'profileRevision')::bigint,(e.envelope::jsonb->>'collectionRevision')::bigint,e.envelope::jsonb->'collectionChange',e.envelope::jsonb->'collectionSnapshot' FROM message_deliveries d JOIN message_events e ON e.id=d.event_id WHERE d.recipient_id=$1 AND d.recipient_generation=$2 AND e.conversation=$3 AND e.audience=$4 AND ($5::bigint=0 OR d.sequence<$5) AND e.redacted_at IS NULL ORDER BY d.sequence DESC LIMIT $6`, actor.AccountID, actor.Generation, conversation, audience, before, limit+1)
	if err != nil {
		return page, auth.ErrUnavailable
	}
	defer rows.Close()
	pending := []candidate{}
	for rows.Next() {
		var item candidate
		d := &item.delivery
		if err = rows.Scan(&d.ID, &d.Operation, &d.Conversation, &d.Audience, &d.SenderID, &d.SenderGeneration, &item.sender, &item.recipient, &item.message, &item.circleID, &item.interval, &d.ContentType, &d.ProfileRevision, &d.CollectionRevision, &d.CollectionChange, &d.CollectionSnapshot); err != nil {
			return page, auth.ErrUnavailable
		}
		pending = append(pending, item)
	}
	if err = rows.Err(); err != nil {
		return page, auth.ErrUnavailable
	}
	rows.Close()
	if err = tx.Commit(ctx); err != nil {
		return page, auth.ErrUnavailable
	}
	page.More = len(pending) > limit
	if page.More {
		pending = pending[:limit]
		page.Cursor = pending[len(pending)-1].delivery.ID
	}
	for _, item := range pending {
		allowed, allowErr := s.deliveryAllowed(ctx, actor, item)
		if allowErr != nil {
			return InboxPage{}, allowErr
		}
		if !allowed {
			continue
		}
		d := item.delivery
		if json.Unmarshal(item.sender, &d.Sender) != nil || json.Unmarshal(item.recipient, &d.RecipientKeys) != nil || json.Unmarshal(item.message, &d.Message) != nil || !validKeys(d.Sender) || !validKeys(d.RecipientKeys) {
			return InboxPage{}, auth.ErrUnavailable
		}
		page.Items = append(page.Items, d)
	}
	for left, right := 0, len(page.Items)-1; left < right; left, right = left+1, right-1 {
		page.Items[left], page.Items[right] = page.Items[right], page.Items[left]
	}
	return page, nil
}
