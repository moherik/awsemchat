package messages

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/push"
)

var ErrConflict = errors.New("message operation conflict")
var ErrRedacted = errors.New("message has been redacted")

type Event struct {
	ID        string `json:"id"`
	Operation string `json:"operation"`
	Status    string `json:"status"`
}

func (s *Service) Send(ctx context.Context, actor auth.Principal, raw string) (Event, error) {
	result := Event{}
	envelope, err := DecodeEnvelope(raw)
	if err != nil {
		return result, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	result, committed, err := s.operationState(ctx, tx, actor, envelope.Operation, raw)
	if err != nil {
		return Event{}, err
	}
	if committed {
		if err := tx.Commit(ctx); err != nil {
			return Event{}, auth.ErrUnavailable
		}
		return result, nil
	}
	digest := sha256.Sum256([]byte(raw))
	// Both metadata streams share the lock before upgrading the Circle row lock.
	if envelope.ContentType == "circle-profile" || envelope.ContentType == "circle-collection" || envelope.ContentType == "circle-collection-snapshot" {
		profile := sha256.Sum256([]byte("awsemchat.circle-profile.v1\x00" + envelope.Conversation))
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(binary.BigEndian.Uint64(profile[:8]))); err != nil {
			return result, auth.ErrUnavailable
		}
	}
	input := ContextInput{CircleID: envelope.Conversation}
	if strings.HasPrefix(envelope.Conversation, "private:") {
		if len(envelope.Recipients) != 1 {
			return result, ErrInvalid
		}
		input = ContextInput{TargetID: envelope.Recipients[0].Peer}
	}
	current, err := s.context(ctx, tx, actor, input)
	if err != nil {
		return result, err
	}
	if current.Conversation != envelope.Conversation || current.Audience != envelope.Audience || current.Sender != envelope.Sender || len(current.Recipients) != len(envelope.Recipients) {
		return result, ErrDenied
	}
	if envelope.ContentType == "private-profile" && current.CircleID != "" {
		return result, ErrDenied
	}
	if envelope.ContentType == "circle-member-profile" && current.CircleID == "" {
		return result, ErrDenied
	}
	if envelope.ContentType == "now-playing" && current.CircleID != "" {
		return result, ErrDenied
	}
	if (envelope.ContentType == "ping" || envelope.ContentType == "pong") && current.CircleID != "" {
		return result, ErrDenied
	}
	if envelope.ContentType == "circle-profile" {
		if current.CircleID == "" {
			return result, ErrDenied
		}
		var admin bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND role='admin' AND left_epoch IS NULL)", current.CircleID, actor.AccountID).Scan(&admin); err != nil {
			return result, auth.ErrUnavailable
		}
		if !admin {
			return result, ErrDenied
		}
		update, err := tx.Exec(ctx, "UPDATE circles SET profile_revision=$1 WHERE id=$2 AND profile_revision=$1-1", *envelope.ProfileRevision, current.CircleID)
		if err != nil {
			return result, auth.ErrUnavailable
		}
		if update.RowsAffected() != 1 {
			return result, ErrConflict
		}
	}
	if envelope.ContentType == "circle-collection" {
		if current.CircleID == "" {
			return result, ErrDenied
		}
		if err := s.applyCollectionChange(ctx, tx, actor, current.CircleID, *envelope.CollectionRevision, *envelope.CollectionChange); err != nil {
			return result, err
		}
	}

	if envelope.ContentType == "circle-collection-snapshot" {
		if current.CircleID == "" {
			return result, ErrDenied
		}
		if err := s.applyCollectionSnapshot(ctx, tx, actor, current.CircleID, current.Epoch, *envelope.CollectionRevision, envelope.Operation, *envelope.CollectionSnapshot); err != nil {
			return result, err
		}
	}

	expected := make(map[string]RecipientBinding, len(current.Recipients))
	for _, recipient := range current.Recipients {
		expected[recipient.AccountID] = recipient
	}
	for _, recipient := range envelope.Recipients {
		binding, exists := expected[recipient.Peer]
		if !exists || binding.Keys != recipient.Keys {
			return result, ErrDenied
		}
	}
	// Serialize each recipient's sequence allocation through commit, so inbox cursors cannot skip late commits.
	queues := append([]RecipientBinding(nil), current.Recipients...)
	sort.Slice(queues, func(i, j int) bool { return queues[i].AccountID < queues[j].AccountID })
	for _, recipient := range queues {
		queue := sha256.Sum256([]byte("awsemchat.delivery-queue.v1\x00" + recipient.AccountID + "\x00" + strconv.FormatInt(recipient.Generation, 10)))
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(binary.BigEndian.Uint64(queue[:8]))); err != nil {
			return Event{}, auth.ErrUnavailable
		}
	}
	result = Event{ID: rand.Text(), Operation: envelope.Operation, Status: "sent"}
	_, err = tx.Exec(ctx, `INSERT INTO message_events(id,sender_id,sender_generation,operation_id,conversation,audience,circle_id,epoch,digest,envelope) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, result.ID, actor.AccountID, actor.Generation, envelope.Operation, current.Conversation, current.Audience, current.CircleID, current.Epoch, digest[:], raw)
	if err != nil {
		return Event{}, auth.ErrUnavailable
	}
	for _, recipient := range envelope.Recipients {
		binding := expected[recipient.Peer]
		public, _ := json.Marshal(recipient.Keys)
		ciphertext, _ := json.Marshal(recipient.Message)
		_, err = tx.Exec(ctx, `INSERT INTO message_deliveries(event_id,recipient_id,recipient_generation,membership_interval,public_keys,ciphertext) VALUES($1,$2,$3,$4,$5,$6)`, result.ID, recipient.Peer, binding.Generation, binding.IntervalID, public, ciphertext)
		if err != nil {
			return Event{}, auth.ErrUnavailable
		}
		if err := push.QueueRecipient(ctx, tx, result.ID, current.Conversation, envelope.ContentType, recipient.Peer, binding.Generation); err != nil {
			return Event{}, auth.ErrUnavailable
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Event{}, auth.ErrUnavailable
	}
	return result, nil
}
