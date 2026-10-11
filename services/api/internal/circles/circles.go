package circles

import (
	"context"
	"crypto/rand"
	"errors"
	"regexp"

	"awsemchat/services/api/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrDenied = errors.New("circle action denied")
var ErrInvalid = errors.New("invalid circle input")
var ErrAdminHandoff = errors.New("circle admin handoff required")

type Circle struct {
	ID          string
	Epoch       int64
	MemberCount int
	Closed      bool
}
type Service struct {
	pool *pgxpool.Pool
	auth *auth.Service
}

func NewService(pool *pgxpool.Pool, identity *auth.Service) *Service {
	return &Service{pool: pool, auth: identity}
}
func (s *Service) Create(ctx context.Context, actor auth.Principal, operation string) (Circle, error) {
	if !idPattern.MatchString(operation) {
		return Circle{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Circle{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Circle{}, err
	}
	c := Circle{ID: rand.Text(), Epoch: 1, MemberCount: 1}
	tag, err := tx.Exec(ctx, "INSERT INTO circles(id,creator_id,operation_id,member_count) VALUES($1,$2,$3,1) ON CONFLICT(creator_id,operation_id) DO NOTHING", c.ID, actor.AccountID, operation)
	if err != nil {
		return Circle{}, auth.ErrUnavailable
	}
	if tag.RowsAffected() == 1 {
		if _, err := tx.Exec(ctx, "INSERT INTO circle_memberships(id,circle_id,account_id,role,joined_epoch) VALUES($1,$2,$3,'admin',1)", rand.Text(), c.ID, actor.AccountID); err != nil {
			return Circle{}, auth.ErrUnavailable
		}
	} else {
		if err := tx.QueryRow(ctx, "SELECT id,epoch,member_count,closed_at IS NOT NULL FROM circles WHERE creator_id=$1 AND operation_id=$2", actor.AccountID, operation).Scan(&c.ID, &c.Epoch, &c.MemberCount, &c.Closed); err != nil {
			return Circle{}, auth.ErrUnavailable
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Circle{}, auth.ErrUnavailable
	}
	return c, nil
}
func (s *Service) Leave(ctx context.Context, actor auth.Principal, id string) error {
	if !idPattern.MatchString(id) {
		return ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	var epoch int64
	var count int
	var closed bool
	err = tx.QueryRow(ctx, "SELECT epoch,member_count,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", id).Scan(&epoch, &count, &closed)
	if errors.Is(err, pgx.ErrNoRows) || closed {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	var interval, role string
	err = tx.QueryRow(ctx, "SELECT id,role FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND left_epoch IS NULL", id, actor.AccountID).Scan(&interval, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	if count > 1 && role == "admin" {
		var admins int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM circle_memberships WHERE circle_id=$1 AND role='admin' AND left_epoch IS NULL", id).Scan(&admins); err != nil {
			return auth.ErrUnavailable
		}
		if admins == 1 {
			return ErrAdminHandoff
		}
	}
	if epoch >= 9007199254740991 {
		return ErrDenied
	}
	epoch++
	if _, err := tx.Exec(ctx, "UPDATE circle_memberships SET left_epoch=$1,left_at=now() WHERE id=$2", epoch, interval); err != nil {
		return auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, "UPDATE circles SET epoch=$1,member_count=member_count-1,closed_at=CASE WHEN member_count=1 THEN now() ELSE NULL END WHERE id=$2", epoch, id); err != nil {
		return auth.ErrUnavailable
	}
	if count == 1 {
		if _, err := tx.Exec(ctx, "UPDATE circle_invites SET status='revoked' WHERE circle_id=$1 AND status='pending'", id); err != nil {
			return auth.ErrUnavailable
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func (s *Service) Handoff(ctx context.Context, actor auth.Principal, circleID, successorID string) error {
	if !idPattern.MatchString(circleID) || !idPattern.MatchString(successorID) {
		return ErrInvalid
	}
	if successorID == actor.AccountID {
		return ErrDenied
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	var closed bool
	err = tx.QueryRow(ctx, "SELECT closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", circleID).Scan(&closed)
	if errors.Is(err, pgx.ErrNoRows) || closed {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	var actorInterval, successorInterval string
	err = tx.QueryRow(ctx, "SELECT id FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND role='admin' AND left_epoch IS NULL", circleID, actor.AccountID).Scan(&actorInterval)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	err = tx.QueryRow(ctx, "SELECT id FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND left_epoch IS NULL", circleID, successorID).Scan(&successorInterval)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, "UPDATE circle_memberships SET role='admin' WHERE id=$1", successorInterval); err != nil {
		return auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, "UPDATE circle_memberships SET role='member' WHERE id=$1", actorInterval); err != nil {
		return auth.ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}
