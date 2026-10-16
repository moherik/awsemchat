package circles

import (
	"context"
	"crypto/rand"
	"errors"
	"regexp"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/friends"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrFull = errors.New("circle is full")
var ErrDenied = errors.New("circle action denied")
var ErrInvalid = errors.New("invalid circle input")
var ErrAdminHandoff = errors.New("circle admin handoff required")

type Circle struct {
	ID          string `json:"id"`
	Epoch       int64  `json:"epoch"`
	MemberCount int    `json:"memberCount"`
	Closed      bool   `json:"closed"`
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
	return s.legacyMembership(ctx, actor, id, "leave", "")
}

func (s *Service) leaveTx(ctx context.Context, tx pgx.Tx, actor auth.Principal, id string) error {
	if !idPattern.MatchString(id) {
		return ErrInvalid
	}
	var epoch int64
	var count int
	var closed bool
	err := tx.QueryRow(ctx, "SELECT epoch,member_count,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", id).Scan(&epoch, &count, &closed)
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
	if _, err := tx.Exec(ctx, "UPDATE circle_invites SET status='revoked' WHERE circle_id=$1 AND inviter_id=$2 AND status='pending'", id, actor.AccountID); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func (s *Service) Handoff(ctx context.Context, actor auth.Principal, circleID, successorID string) error {
	return s.legacyMembership(ctx, actor, circleID, "handoff", successorID)
}

func (s *Service) handoffTx(ctx context.Context, tx pgx.Tx, actor auth.Principal, circleID, successorID string) error {
	if !idPattern.MatchString(circleID) || !idPattern.MatchString(successorID) {
		return ErrInvalid
	}
	if successorID == actor.AccountID {
		return ErrDenied
	}
	var closed bool
	err := tx.QueryRow(ctx, "SELECT closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", circleID).Scan(&closed)
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
	if _, err := tx.Exec(ctx, "UPDATE circle_invites SET status='revoked' WHERE circle_id=$1 AND inviter_id=$2 AND status='pending'", circleID, actor.AccountID); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}

type Invitation struct {
	ID         string `json:"id"`
	CircleID   string `json:"circleId"`
	InviterID  string `json:"inviterId"`
	InviteeID  string `json:"inviteeId"`
	Status     string `json:"status"`
	IntervalID string `json:"intervalId,omitempty"`
}

func (s *Service) Invite(ctx context.Context, actor auth.Principal, circleID, inviteeID string) (Invitation, error) {
	if !idPattern.MatchString(circleID) || !idPattern.MatchString(inviteeID) {
		return Invitation{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Invitation{}, err
	}
	var epoch int64
	var closed bool
	err = tx.QueryRow(ctx, "SELECT epoch,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", circleID).Scan(&epoch, &closed)
	if errors.Is(err, pgx.ErrNoRows) || closed {
		return Invitation{}, ErrDenied
	}
	if err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	var allowed bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND role='admin' AND left_epoch IS NULL)", circleID, actor.AccountID).Scan(&allowed); err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	if !allowed {
		return Invitation{}, ErrDenied
	}
	if err := friends.NewService(s.pool, s.auth).RequireAccepted(ctx, tx, actor, inviteeID); err != nil {
		if errors.Is(err, friends.ErrDenied) {
			return Invitation{}, ErrDenied
		}
		return Invitation{}, err
	}
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND left_epoch IS NULL)", circleID, inviteeID).Scan(&allowed); err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	if allowed {
		return Invitation{}, ErrDenied
	}
	if _, err := tx.Exec(ctx, "UPDATE circle_invites SET status='revoked' WHERE circle_id=$1 AND invitee_id=$2 AND status='pending' AND expires_at<=now()", circleID, inviteeID); err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	i := Invitation{CircleID: circleID, InviteeID: inviteeID, Status: "pending"}
	err = tx.QueryRow(ctx, "SELECT id,inviter_id FROM circle_invites WHERE circle_id=$1 AND invitee_id=$2 AND status='pending'", circleID, inviteeID).Scan(&i.ID, &i.InviterID)
	if err == nil {
		if i.InviterID != actor.AccountID {
			return Invitation{}, ErrDenied
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		i.ID = rand.Text()
		i.InviterID = actor.AccountID
		if _, err := tx.Exec(ctx, "INSERT INTO circle_invites(id,circle_id,inviter_id,invitee_id,status,created_epoch,expires_at) VALUES($1,$2,$3,$4,'pending',$5,now()+interval '7 days')", i.ID, circleID, actor.AccountID, inviteeID, epoch); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
	} else {
		return Invitation{}, auth.ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	return i, nil
}
func (s *Service) Respond(ctx context.Context, actor auth.Principal, invitationID string, accept bool) (Invitation, error) {
	if !idPattern.MatchString(invitationID) {
		return Invitation{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Invitation{}, err
	}
	i := Invitation{ID: invitationID}
	err = tx.QueryRow(ctx, "SELECT circle_id,inviter_id,invitee_id FROM circle_invites WHERE id=$1", invitationID).Scan(&i.CircleID, &i.InviterID, &i.InviteeID)
	if errors.Is(err, pgx.ErrNoRows) || i.InviteeID != actor.AccountID {
		return Invitation{}, ErrDenied
	}
	if err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	var epoch int64
	var count int
	var closed bool
	err = tx.QueryRow(ctx, "SELECT epoch,member_count,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", i.CircleID).Scan(&epoch, &count, &closed)
	if err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	if closed {
		return Invitation{}, ErrDenied
	}
	var expired bool
	if err := tx.QueryRow(ctx, "SELECT status,COALESCE(accepted_interval_id,''),expires_at<=now() FROM circle_invites WHERE id=$1", invitationID).Scan(&i.Status, &i.IntervalID, &expired); err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	if !accept && i.Status == "declined" {
		if err := tx.Commit(ctx); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
		return i, nil
	}
	if accept && i.Status == "accepted" {
		var active bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE id=$1 AND left_epoch IS NULL)", i.IntervalID).Scan(&active); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
		if !active {
			return Invitation{}, ErrDenied
		}
		if err := tx.Commit(ctx); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
		return i, nil
	}
	if i.Status != "pending" || expired {
		return Invitation{}, ErrDenied
	}
	if !accept {
		if _, err := tx.Exec(ctx, "UPDATE circle_invites SET status='declined' WHERE id=$1", invitationID); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
		i.Status = "declined"
	} else {
		var admin, active bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND role='admin' AND left_epoch IS NULL),EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$3 AND left_epoch IS NULL)", i.CircleID, i.InviterID, actor.AccountID).Scan(&admin, &active); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
		if !admin || active {
			return Invitation{}, ErrDenied
		}
		if err := friends.NewService(s.pool, s.auth).RequireAccepted(ctx, tx, actor, i.InviterID); err != nil {
			if errors.Is(err, friends.ErrDenied) {
				return Invitation{}, ErrDenied
			}
			return Invitation{}, err
		}
		if count >= 20 {
			return Invitation{}, ErrFull
		}
		if epoch >= 9007199254740991 {
			return Invitation{}, ErrDenied
		}
		epoch++
		i.IntervalID = rand.Text()
		i.Status = "accepted"
		if _, err := tx.Exec(ctx, "INSERT INTO circle_memberships(id,circle_id,account_id,role,joined_epoch) VALUES($1,$2,$3,'member',$4)", i.IntervalID, i.CircleID, actor.AccountID, epoch); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
		if _, err := tx.Exec(ctx, "UPDATE circles SET epoch=$1,member_count=member_count+1 WHERE id=$2", epoch, i.CircleID); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
		if _, err := tx.Exec(ctx, "UPDATE circle_invites SET status='accepted',accepted_interval_id=$1 WHERE id=$2", i.IntervalID, invitationID); err != nil {
			return Invitation{}, auth.ErrUnavailable
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Invitation{}, auth.ErrUnavailable
	}
	return i, nil
}

func (s *Service) Remove(ctx context.Context, actor auth.Principal, circleID, targetID string) error {
	return s.legacyMembership(ctx, actor, circleID, "remove", targetID)
}

func (s *Service) removeTx(ctx context.Context, tx pgx.Tx, actor auth.Principal, circleID, targetID string) error {
	if !idPattern.MatchString(circleID) || !idPattern.MatchString(targetID) {
		return ErrInvalid
	}
	if targetID == actor.AccountID {
		return ErrDenied
	}
	var epoch int64
	var closed bool
	err := tx.QueryRow(ctx, "SELECT epoch,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", circleID).Scan(&epoch, &closed)
	if errors.Is(err, pgx.ErrNoRows) || closed {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	var admin bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND role='admin' AND left_epoch IS NULL)", circleID, actor.AccountID).Scan(&admin); err != nil {
		return auth.ErrUnavailable
	}
	if !admin {
		return ErrDenied
	}
	var interval string
	err = tx.QueryRow(ctx, "SELECT id FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND left_epoch IS NULL", circleID, targetID).Scan(&interval)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDenied
	}
	if err != nil {
		return auth.ErrUnavailable
	}
	if epoch >= 9007199254740991 {
		return ErrDenied
	}
	epoch++
	if _, err := tx.Exec(ctx, "UPDATE circle_memberships SET left_epoch=$1,left_at=now() WHERE id=$2", epoch, interval); err != nil {
		return auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, "UPDATE circles SET epoch=$1,member_count=member_count-1 WHERE id=$2", epoch, circleID); err != nil {
		return auth.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, "UPDATE circle_invites SET status='revoked' WHERE circle_id=$1 AND inviter_id=$2 AND status='pending'", circleID, targetID); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}
