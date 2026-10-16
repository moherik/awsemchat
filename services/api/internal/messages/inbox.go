package messages

import (
	"context"
	"encoding/json"
	"errors"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
	"github.com/jackc/pgx/v5"
)

type Delivery struct {
	CollectionSnapshot *CollectionSnapshot `json:"collectionSnapshot,omitempty"`
	CollectionRevision *int64              `json:"collectionRevision,omitempty"`
	CollectionChange   *CollectionChange   `json:"collectionChange,omitempty"`
	ProfileRevision    *int64              `json:"profileRevision,omitempty"`
	ContentType        string              `json:"contentType,omitempty"`
	ID                 string              `json:"id"`
	Operation          string              `json:"operation"`
	Conversation       string              `json:"conversation"`
	Audience           string              `json:"audience"`
	SenderID           string              `json:"senderId"`
	SenderGeneration   int64               `json:"senderGeneration"`
	Sender             PeerKeys            `json:"sender"`
	RecipientKeys      PeerKeys            `json:"recipientKeys"`
	Message            Ciphertext          `json:"message"`
}
type InboxPage struct {
	Items  []Delivery `json:"items"`
	Cursor string     `json:"cursor,omitempty"`
	More   bool       `json:"more"`
}
type candidate struct {
	delivery                   Delivery
	circleID                   string
	interval                   string
	sender, recipient, message []byte
}

func (s *Service) Inbox(ctx context.Context, actor auth.Principal, cursor string, limit int) (InboxPage, error) {
	page := InboxPage{Items: []Delivery{}, Cursor: cursor}
	if limit < 1 || limit > 25 || (cursor != "" && !identifier.MatchString(cursor)) {
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
	var after int64
	if cursor != "" {
		err = tx.QueryRow(ctx, "SELECT sequence FROM message_deliveries WHERE event_id=$1 AND recipient_id=$2 AND recipient_generation=$3", cursor, actor.AccountID, actor.Generation).Scan(&after)
		if errors.Is(err, pgx.ErrNoRows) {
			return page, ErrInvalid
		}
		if err != nil {
			return page, auth.ErrUnavailable
		}
	}
	rows, err := tx.Query(ctx, `SELECT d.event_id,e.operation_id,e.conversation,e.audience,e.sender_id,e.sender_generation,e.envelope::jsonb->'sender',d.public_keys,d.ciphertext,e.circle_id,d.membership_interval,COALESCE(e.envelope::jsonb->>'contentType',''),(e.envelope::jsonb->>'profileRevision')::bigint,(e.envelope::jsonb->>'collectionRevision')::bigint,e.envelope::jsonb->'collectionChange',e.envelope::jsonb->'collectionSnapshot' FROM message_deliveries d JOIN message_events e ON e.id=d.event_id WHERE d.recipient_id=$1 AND d.recipient_generation=$2 AND d.sequence>$3 AND e.redacted_at IS NULL ORDER BY d.sequence LIMIT $4`, actor.AccountID, actor.Generation, after, limit+1)
	if err != nil {
		return page, auth.ErrUnavailable
	}
	defer rows.Close()
	pending := []candidate{}
	for rows.Next() {
		var c candidate
		d := &c.delivery
		if rows.Scan(&d.ID, &d.Operation, &d.Conversation, &d.Audience, &d.SenderID, &d.SenderGeneration, &c.sender, &c.recipient, &c.message, &c.circleID, &c.interval, &d.ContentType, &d.ProfileRevision, &d.CollectionRevision, &d.CollectionChange, &d.CollectionSnapshot) != nil {
			return page, auth.ErrUnavailable
		}
		pending = append(pending, c)
	}
	if rows.Err() != nil {
		return page, auth.ErrUnavailable
	}
	rows.Close()
	if err = tx.Commit(ctx); err != nil {
		return page, auth.ErrUnavailable
	}
	page.More = len(pending) > limit
	if page.More {
		pending = pending[:limit]
	}
	// Separate grant transactions avoid holding a friend-pair lock while waiting for a Circle lock.
	for _, c := range pending {
		allowed, err := s.deliveryAllowed(ctx, actor, c)
		if err != nil {
			return InboxPage{}, err
		}
		page.Cursor = c.delivery.ID
		if !allowed {
			continue
		}
		if json.Unmarshal(c.sender, &c.delivery.Sender) != nil || json.Unmarshal(c.recipient, &c.delivery.RecipientKeys) != nil || json.Unmarshal(c.message, &c.delivery.Message) != nil || !validKeys(c.delivery.Sender) || !validKeys(c.delivery.RecipientKeys) {
			return InboxPage{}, auth.ErrUnavailable
		}
		page.Items = append(page.Items, c.delivery)
	}
	return page, nil
}
func (s *Service) deliveryAllowed(ctx context.Context, actor auth.Principal, c candidate) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return false, err
	}
	if c.circleID != "" {
		audience, err := circles.NewService(s.pool, s.auth).CurrentAudience(ctx, tx, actor, c.circleID)
		if errors.Is(err, circles.ErrDenied) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		found := false
		for _, member := range audience.Members {
			if member.AccountID == actor.AccountID && member.IntervalID == c.interval {
				found = true
			}
		}
		if !found {
			return false, nil
		}
	} else {
		request, err := friends.NewService(s.pool, s.auth).AcceptedRequest(ctx, tx, actor, c.delivery.SenderID)
		if errors.Is(err, friends.ErrDenied) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if c.delivery.Audience != "friend:"+request {
			return false, nil
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return false, auth.ErrUnavailable
	}
	return true, nil
}
