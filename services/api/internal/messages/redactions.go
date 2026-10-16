package messages

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strconv"
	"strings"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

type LegacyMessageIdentity struct {
	Conversation string   `json:"conversation"`
	Audience     string   `json:"audience"`
	Operation    string   `json:"operation"`
	PeerKeys     PeerKeys `json:"peerKeys"`
}

type RedactionTarget struct {
	EventID string                 `json:"eventId,omitempty"`
	Legacy  *LegacyMessageIdentity `json:"legacy,omitempty"`
}

func (target *RedactionTarget) UnmarshalJSON(raw []byte) error {
	if !jsonKeysAreUnique(raw) {
		return ErrInvalid
	}
	type redactionTarget RedactionTarget
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var value redactionTarget
	if decoder.Decode(&value) != nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
		return ErrInvalid
	}
	*target = RedactionTarget(value)
	return nil
}

func jsonKeysAreUnique(raw []byte) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if consumeUniqueJSONValue(decoder) != nil {
		return false
	}
	return errors.Is(decoder.Decode(new(any)), io.EOF)
}

func consumeUniqueJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := map[string]struct{}{}
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return ErrInvalid
			}
			if _, exists := seen[key]; exists {
				return ErrInvalid
			}
			seen[key] = struct{}{}
			if err := consumeUniqueJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	case '[':
		for decoder.More() {
			if err := consumeUniqueJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	default:
		return ErrInvalid
	}
}

type Redaction struct {
	EventID      string   `json:"eventId"`
	Conversation string   `json:"conversation"`
	Audience     string   `json:"audience"`
	Operation    string   `json:"operation"`
	Sender       PeerKeys `json:"sender"`
	Cursor       string   `json:"cursor"`
}

type RedactionPage struct {
	Items  []Redaction `json:"items"`
	Cursor string      `json:"cursor"`
	More   bool        `json:"more"`
}

func (s *Service) Redact(ctx context.Context, actor auth.Principal, target RedactionTarget) (Redaction, error) {
	if (target.EventID == "") == (target.Legacy == nil) {
		return Redaction{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Redaction{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Redaction{}, err
	}
	eventID := target.EventID
	if target.Legacy != nil {
		legacy := target.Legacy
		if !identifier.MatchString(legacy.Conversation) || !identifier.MatchString(legacy.Audience) || !identifier.MatchString(legacy.Operation) || !validKeys(legacy.PeerKeys) {
			return Redaction{}, ErrInvalid
		}
		keys, _ := json.Marshal(legacy.PeerKeys)
		rows, err := tx.Query(ctx, `SELECT e.id FROM message_events e LEFT JOIN message_redactions r ON r.event_id=e.id WHERE e.sender_id=$1 AND e.conversation=$2 AND e.audience=$3 AND e.operation_id=$4 AND COALESCE(r.sender_keys,e.envelope::jsonb->'sender')=$5::jsonb ORDER BY e.id LIMIT 2`, actor.AccountID, legacy.Conversation, legacy.Audience, legacy.Operation, keys)
		if err != nil {
			return Redaction{}, auth.ErrUnavailable
		}
		var matches []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return Redaction{}, auth.ErrUnavailable
			}
			matches = append(matches, id)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return Redaction{}, auth.ErrUnavailable
		}
		rows.Close()
		if len(matches) != 1 {
			if len(matches) > 1 {
				return Redaction{}, ErrConflict
			}
			return Redaction{}, ErrDenied
		}
		eventID = matches[0]
	}
	if !identifier.MatchString(eventID) {
		return Redaction{}, ErrInvalid
	}
	var result Redaction
	var eventSender string
	var rawEnvelope string
	var redacted bool
	var senderJSON []byte
	err = tx.QueryRow(ctx, `SELECT e.id,e.sender_id,e.conversation,e.audience,e.operation_id,e.envelope,e.redacted_at IS NOT NULL,COALESCE(r.sender_keys,e.envelope::jsonb->'sender') FROM message_events e LEFT JOIN message_redactions r ON r.event_id=e.id WHERE e.id=$1 FOR UPDATE OF e`, eventID).Scan(&result.EventID, &eventSender, &result.Conversation, &result.Audience, &result.Operation, &rawEnvelope, &redacted, &senderJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Redaction{}, ErrDenied
		}
		return Redaction{}, auth.ErrUnavailable
	}
	if eventSender != actor.AccountID {
		return Redaction{}, ErrDenied
	}
	if err = json.Unmarshal(senderJSON, &result.Sender); err != nil || !validKeys(result.Sender) {
		return Redaction{}, auth.ErrUnavailable
	}
	if redacted {
		var sequence int64
		if err = tx.QueryRow(ctx, `SELECT f.sequence FROM message_redaction_feed f WHERE f.account_id=$1 AND f.event_id=$2`, actor.AccountID, eventID).Scan(&sequence); err != nil {
			return Redaction{}, auth.ErrUnavailable
		}
		result.Cursor = redactionCursor(actor.AccountID, sequence)
		if err = tx.Commit(ctx); err != nil {
			return Redaction{}, auth.ErrUnavailable
		}
		return result, nil
	}
	var envelope Envelope
	if json.Unmarshal([]byte(rawEnvelope), &envelope) != nil || (envelope.ContentType != "" && envelope.ContentType != "text" && envelope.ContentType != "ping" && envelope.ContentType != "pong") {
		return Redaction{}, ErrDenied
	}
	rows, err := tx.Query(ctx, `SELECT recipient_id FROM message_deliveries WHERE event_id=$1 ORDER BY recipient_id`, eventID)
	if err != nil {
		return Redaction{}, auth.ErrUnavailable
	}
	accounts := []string{actor.AccountID}
	for rows.Next() {
		var account string
		if err := rows.Scan(&account); err != nil {
			rows.Close()
			return Redaction{}, auth.ErrUnavailable
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return Redaction{}, auth.ErrUnavailable
	}
	rows.Close()
	sort.Strings(accounts)
	accounts = uniqueStrings(accounts)
	for _, account := range accounts {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('message-redaction-feed:'||$1,0))`, account); err != nil {
			return Redaction{}, auth.ErrUnavailable
		}
	}
	keysJSON, _ := json.Marshal(result.Sender)
	if _, err := tx.Exec(ctx, `INSERT INTO message_redactions(event_id,sender_id,conversation,audience,operation_id,sender_keys) VALUES($1,$2,$3,$4,$5,$6)`, eventID, actor.AccountID, result.Conversation, result.Audience, result.Operation, keysJSON); err != nil {
		return Redaction{}, auth.ErrUnavailable
	}
	var senderSequence int64
	for _, account := range accounts {
		var sequence int64
		if err := tx.QueryRow(ctx, `INSERT INTO message_redaction_cursors(account_id,sequence) VALUES($1,1) ON CONFLICT(account_id) DO UPDATE SET sequence=message_redaction_cursors.sequence+1 RETURNING sequence`, account).Scan(&sequence); err != nil {
			return Redaction{}, auth.ErrUnavailable
		}
		if _, err := tx.Exec(ctx, `INSERT INTO message_redaction_feed(account_id,sequence,event_id) VALUES($1,$2,$3)`, account, sequence, eventID); err != nil {
			return Redaction{}, auth.ErrUnavailable
		}
		if account == actor.AccountID {
			senderSequence = sequence
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE message_events SET envelope='{}',redacted_at=now() WHERE id=$1`, eventID); err != nil {
		return Redaction{}, auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `UPDATE message_deliveries SET ciphertext='{}'::jsonb WHERE event_id=$1`, eventID); err != nil {
		return Redaction{}, auth.ErrUnavailable
	}
	result.Cursor = redactionCursor(actor.AccountID, senderSequence)
	if err = tx.Commit(ctx); err != nil {
		return Redaction{}, auth.ErrUnavailable
	}
	return result, nil
}

func (s *Service) Redactions(ctx context.Context, actor auth.Principal, cursor string, limit int) (RedactionPage, error) {
	page := RedactionPage{Items: []Redaction{}, Cursor: cursor}
	if limit < 1 || limit > 100 {
		return page, ErrInvalid
	}
	after, err := parseRedactionCursor(actor.AccountID, cursor)
	if err != nil {
		return page, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return page, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err = s.auth.LockSession(ctx, tx, actor); err != nil {
		return page, err
	}
	rows, err := tx.Query(ctx, `SELECT r.event_id,r.conversation,r.audience,r.operation_id,r.sender_keys,f.sequence FROM message_redaction_feed f JOIN message_redactions r ON r.event_id=f.event_id WHERE f.account_id=$1 AND f.sequence>$2 ORDER BY f.sequence LIMIT $3`, actor.AccountID, after, limit+1)
	if err != nil {
		return page, auth.ErrUnavailable
	}
	var sequences []int64
	for rows.Next() {
		var item Redaction
		var sender []byte
		var sequence int64
		if err := rows.Scan(&item.EventID, &item.Conversation, &item.Audience, &item.Operation, &sender, &sequence); err != nil || json.Unmarshal(sender, &item.Sender) != nil || !validKeys(item.Sender) {
			rows.Close()
			return RedactionPage{}, auth.ErrUnavailable
		}
		page.Items = append(page.Items, item)
		sequences = append(sequences, sequence)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return RedactionPage{}, auth.ErrUnavailable
	}
	rows.Close()
	if err = tx.Commit(ctx); err != nil {
		return RedactionPage{}, auth.ErrUnavailable
	}
	page.More = len(page.Items) > limit
	if page.More {
		page.Items = page.Items[:limit]
		sequences = sequences[:limit]
	}
	if len(sequences) != 0 {
		page.Cursor = redactionCursor(actor.AccountID, sequences[len(sequences)-1])
	}
	return page, nil
}

func redactionCursor(account string, sequence int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte(account + ":" + strconv.FormatInt(sequence, 10)))
}

func parseRedactionCursor(account, cursor string) (int64, error) {
	if cursor == "" {
		return 0, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, ErrInvalid
	}
	owner, value, ok := strings.Cut(string(decoded), ":")
	sequence, parseErr := strconv.ParseInt(value, 10, 64)
	if !ok || owner != account || parseErr != nil || sequence < 0 {
		return 0, ErrInvalid
	}
	return sequence, nil
}

func uniqueStrings(values []string) []string {
	if len(values) < 2 {
		return values
	}
	unique := values[:1]
	for _, value := range values[1:] {
		if value != unique[len(unique)-1] {
			unique = append(unique, value)
		}
	}
	return unique
}
