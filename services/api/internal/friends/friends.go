package friends

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"regexp"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrDenied = errors.New("friendship action denied")
var ErrInvalid = errors.New("invalid friendship input")
var pinPattern = regexp.MustCompile(`^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$`)
var idPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

type Request struct {
	ID          string `json:"id"`
	RequestedBy string `json:"requestedBy"`
	TargetID    string `json:"targetId"`
	Status      string `json:"status"`
}
type Service struct {
	pool *pgxpool.Pool
	auth *auth.Service
}

func NewService(pool *pgxpool.Pool, identity *auth.Service) *Service {
	return &Service{pool: pool, auth: identity}
}

func (s *Service) pair(ctx context.Context, actor auth.Principal, peer string, work func(pgx.Tx, string, string) error) error {
	if !idPattern.MatchString(peer) || peer == actor.AccountID {
		return ErrDenied
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	low, high, err := s.lockPair(ctx, tx, actor, peer)
	if err != nil {
		return err
	}
	if err := work(tx, low, high); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

func (s *Service) lockPair(ctx context.Context, tx pgx.Tx, actor auth.Principal, peer string) (string, string, error) {
	if tx == nil || !idPattern.MatchString(peer) || peer == actor.AccountID {
		return "", "", ErrDenied
	}
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return "", "", err
	}
	low, high := actor.AccountID, peer
	if low > high {
		low, high = high, low
	}
	digest := sha256.Sum256([]byte("awsemchat.friend-pair\x00" + low + "\x00" + high))
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(binary.BigEndian.Uint64(digest[:8]))); err != nil {
		return "", "", auth.ErrUnavailable
	}
	return low, high, nil
}
func blocked(ctx context.Context, tx pgx.Tx, low, high string) (bool, error) {
	var value bool
	err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM friend_blocks WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1))", low, high).Scan(&value)
	if err != nil {
		return false, auth.ErrUnavailable
	}
	return value, nil
}
func (s *Service) Request(ctx context.Context, actor auth.Principal, pin string) (Request, error) {
	if !pinPattern.MatchString(pin) {
		return Request{}, ErrInvalid
	}
	var peer string
	err := s.pool.QueryRow(ctx, "SELECT id FROM auth_accounts WHERE pin=$1", pin).Scan(&peer)
	if errors.Is(err, pgx.ErrNoRows) {
		return Request{}, ErrDenied
	}
	if err != nil {
		return Request{}, auth.ErrUnavailable
	}
	result := Request{}
	err = s.pair(ctx, actor, peer, func(tx pgx.Tx, low, high string) error {
		denied, err := blocked(ctx, tx, low, high)
		if err != nil {
			return err
		}
		if denied {
			return ErrDenied
		}
		err = tx.QueryRow(ctx, "SELECT request_id,requested_by,status FROM friend_links WHERE low_id=$1 AND high_id=$2", low, high).Scan(&result.ID, &result.RequestedBy, &result.Status)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return auth.ErrUnavailable
		}
		if errors.Is(err, pgx.ErrNoRows) || result.Status == "declined" {
			result = Request{ID: rand.Text(), RequestedBy: actor.AccountID, Status: "pending"}
			if _, err := tx.Exec(ctx, `INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT(low_id,high_id) DO UPDATE SET request_id=EXCLUDED.request_id,requested_by=EXCLUDED.requested_by,status='pending',created_at=now(),updated_at=now()`, low, high, result.ID, actor.AccountID); err != nil {
				return auth.ErrUnavailable
			}
		}
		result.TargetID = low
		if result.RequestedBy == low {
			result.TargetID = high
		}
		return nil
	})
	return result, err
}
func (s *Service) Respond(ctx context.Context, actor auth.Principal, requestID string, accept bool) error {
	if !idPattern.MatchString(requestID) {
		return ErrInvalid
	}
	var low, high, requester string
	err := s.pool.QueryRow(ctx, "SELECT low_id,high_id,requested_by FROM friend_links WHERE request_id=$1", requestID).Scan(&low, &high, &requester)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	if actor.AccountID == requester || (actor.AccountID != low && actor.AccountID != high) {
		return ErrDenied
	}
	peer := low
	if actor.AccountID == low {
		peer = high
	}
	return s.pair(ctx, actor, peer, func(tx pgx.Tx, low, high string) error {
		denied, err := blocked(ctx, tx, low, high)
		if err != nil {
			return err
		}
		if denied {
			return ErrDenied
		}
		status := "declined"
		if accept {
			status = "accepted"
		}
		var existing string
		err = tx.QueryRow(ctx, "SELECT status FROM friend_links WHERE request_id=$1 AND low_id=$2 AND high_id=$3 AND requested_by<>$4", requestID, low, high, actor.AccountID).Scan(&existing)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDenied
		}
		if err != nil {
			return auth.ErrUnavailable
		}
		if existing == status {
			return nil
		}
		if existing != "pending" {
			return ErrDenied
		}
		updated, err := tx.Exec(ctx, "UPDATE friend_links SET status=$1,updated_at=now() WHERE request_id=$2 AND low_id=$3 AND high_id=$4 AND requested_by<>$5 AND status='pending'", status, requestID, low, high, actor.AccountID)
		if err != nil {
			return auth.ErrUnavailable
		}
		if updated.RowsAffected() != 1 {
			return ErrDenied
		}
		return nil
	})
}
func (s *Service) Allowed(ctx context.Context, actor auth.Principal, peer string) (bool, error) {
	allowed := false
	err := s.pair(ctx, actor, peer, func(tx pgx.Tx, low, high string) error {
		denied, err := blocked(ctx, tx, low, high)
		if err != nil {
			return err
		}
		if denied {
			return nil
		}
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM friend_links WHERE low_id=$1 AND high_id=$2 AND status='accepted')", low, high).Scan(&allowed); err != nil {
			return auth.ErrUnavailable
		}
		return nil
	})
	return allowed, err
}
func (s *Service) Block(ctx context.Context, actor auth.Principal, peer string, enabled bool) error {
	return s.pair(ctx, actor, peer, func(tx pgx.Tx, low, high string) error {
		var exists bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM auth_accounts WHERE id=$1)", peer).Scan(&exists); err != nil {
			return auth.ErrUnavailable
		}
		if !exists {
			return ErrDenied
		}
		if enabled {
			if _, err := tx.Exec(ctx, "INSERT INTO friend_blocks(actor_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING", actor.AccountID, peer); err != nil {
				return auth.ErrUnavailable
			}
			if _, err := tx.Exec(ctx, "DELETE FROM friend_links WHERE low_id=$1 AND high_id=$2", low, high); err != nil {
				return auth.ErrUnavailable
			}
		} else {
			if _, err := tx.Exec(ctx, "DELETE FROM friend_blocks WHERE actor_id=$1 AND target_id=$2", actor.AccountID, peer); err != nil {
				return auth.ErrUnavailable
			}
		}
		return nil
	})
}

func (s *Service) RequireAccepted(ctx context.Context, tx pgx.Tx, actor auth.Principal, peer string) error {
	low, high, err := s.lockPair(ctx, tx, actor, peer)
	if err != nil {
		return err
	}
	denied, err := blocked(ctx, tx, low, high)
	if err != nil {
		return err
	}
	if denied {
		return ErrDenied
	}
	var accepted bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM friend_links WHERE low_id=$1 AND high_id=$2 AND status='accepted')", low, high).Scan(&accepted); err != nil {
		return auth.ErrUnavailable
	}
	if !accepted {
		return ErrDenied
	}
	return nil
}

func (s *Service) AcceptedRequest(ctx context.Context, tx pgx.Tx, actor auth.Principal, peer string) (string, error) {
	if err := s.RequireAccepted(ctx, tx, actor, peer); err != nil {
		return "", err
	}
	low, high := actor.AccountID, peer
	if low > high {
		low, high = high, low
	}
	var request string
	if err := tx.QueryRow(ctx, "SELECT request_id FROM friend_links WHERE low_id=$1 AND high_id=$2 AND status='accepted'", low, high).Scan(&request); err != nil {
		return "", auth.ErrUnavailable
	}
	return request, nil
}

type Contact struct {
	AccountID string `json:"accountId"`
	PIN       string `json:"pin"`
	RequestID string `json:"requestId,omitempty"`
	Status    string `json:"status"`
}
type Page struct {
	Items      []Contact `json:"items"`
	NextCursor string    `json:"nextCursor,omitempty"`
}

func (s *Service) List(ctx context.Context, actor auth.Principal, kind, cursor string, limit int) (Page, error) {
	if limit < 1 || limit > 100 || (cursor != "" && !idPattern.MatchString(cursor)) {
		return Page{}, ErrInvalid
	}
	condition := ""
	switch kind {
	case "accepted":
		condition = "l.status='accepted'"
	case "incoming":
		condition = "l.status='pending' AND l.requested_by<>$1"
	case "outgoing":
		condition = "l.status='pending' AND l.requested_by=$1"
	case "blocked":
	default:
		return Page{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Page{}, err
	}
	query := `SELECT a.id,a.pin,l.request_id,l.status FROM friend_links l JOIN auth_accounts a ON a.id=CASE WHEN l.low_id=$1 THEN l.high_id ELSE l.low_id END WHERE (l.low_id=$1 OR l.high_id=$1) AND ` + condition + ` AND a.id>$2 AND NOT EXISTS(SELECT 1 FROM friend_blocks b WHERE (b.actor_id=$1 AND b.target_id=a.id) OR (b.actor_id=a.id AND b.target_id=$1)) ORDER BY a.id LIMIT $3`
	if kind == "blocked" {
		query = `SELECT a.id,a.pin,''::text,'blocked'::text FROM friend_blocks b JOIN auth_accounts a ON a.id=b.target_id WHERE b.actor_id=$1 AND a.id>$2 ORDER BY a.id LIMIT $3`
	}
	rows, err := tx.Query(ctx, query, actor.AccountID, cursor, limit+1)
	if err != nil {
		return Page{}, auth.ErrUnavailable
	}
	defer rows.Close()
	page := Page{Items: make([]Contact, 0, limit+1)}
	for rows.Next() {
		var item Contact
		if err := rows.Scan(&item.AccountID, &item.PIN, &item.RequestID, &item.Status); err != nil {
			return Page{}, auth.ErrUnavailable
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, auth.ErrUnavailable
	}
	rows.Close()
	if len(page.Items) > limit {
		page.NextCursor = page.Items[limit-1].AccountID
		page.Items = page.Items[:limit]
	}
	if err := tx.Commit(ctx); err != nil {
		return Page{}, auth.ErrUnavailable
	}
	return page, nil
}
