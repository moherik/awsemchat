package circles

import (
	"awsemchat/services/api/internal/auth"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

type Membership struct {
	IntervalID  string `json:"intervalId"`
	AccountID   string `json:"accountId"`
	PIN         string `json:"pin"`
	Role        string `json:"role"`
	JoinedEpoch int64  `json:"joinedEpoch"`
}
type Summary struct {
	Circle
	IntervalID  string `json:"intervalId"`
	Role        string `json:"role"`
	JoinedEpoch int64  `json:"joinedEpoch"`
}
type Page struct {
	Items      []Summary `json:"items"`
	NextCursor string    `json:"nextCursor,omitempty"`
}
type Details struct {
	Circle
	Members []Membership `json:"members"`
}
type InvitationPage struct {
	Items      []Invitation `json:"items"`
	NextCursor string       `json:"nextCursor,omitempty"`
}

func (s *Service) List(ctx context.Context, actor auth.Principal, cursor string, limit int) (Page, error) {
	if limit < 1 || limit > 100 || (cursor != "" && !idPattern.MatchString(cursor)) {
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
	rows, err := tx.Query(ctx, "SELECT c.id,c.epoch,c.member_count,m.id,m.role,m.joined_epoch FROM circles c JOIN circle_memberships m ON m.circle_id=c.id WHERE m.account_id=$1 AND m.left_epoch IS NULL AND c.closed_at IS NULL AND c.id>$2 ORDER BY c.id LIMIT $3", actor.AccountID, cursor, limit+1)
	if err != nil {
		return Page{}, auth.ErrUnavailable
	}
	defer rows.Close()
	page := Page{Items: make([]Summary, 0, limit+1)}
	for rows.Next() {
		var item Summary
		if err := rows.Scan(&item.ID, &item.Epoch, &item.MemberCount, &item.IntervalID, &item.Role, &item.JoinedEpoch); err != nil {
			return Page{}, auth.ErrUnavailable
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, auth.ErrUnavailable
	}
	rows.Close()
	if len(page.Items) > limit {
		page.NextCursor = page.Items[limit-1].ID
		page.Items = page.Items[:limit]
	}
	if err := tx.Commit(ctx); err != nil {
		return Page{}, auth.ErrUnavailable
	}
	return page, nil
}
func (s *Service) Details(ctx context.Context, actor auth.Principal, id string) (Details, error) {
	if !idPattern.MatchString(id) {
		return Details{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Details{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return Details{}, err
	}
	d := Details{Members: make([]Membership, 0, 20)}
	err = tx.QueryRow(ctx, "SELECT id,epoch,member_count,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR SHARE", id).Scan(&d.ID, &d.Epoch, &d.MemberCount, &d.Closed)
	if errors.Is(err, pgx.ErrNoRows) || d.Closed {
		return Details{}, ErrDenied
	}
	if err != nil {
		return Details{}, auth.ErrUnavailable
	}
	var member bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND left_epoch IS NULL)", id, actor.AccountID).Scan(&member); err != nil {
		return Details{}, auth.ErrUnavailable
	}
	if !member {
		return Details{}, ErrDenied
	}
	rows, err := tx.Query(ctx, "SELECT m.id,m.account_id,a.pin,m.role,m.joined_epoch FROM circle_memberships m JOIN auth_accounts a ON a.id=m.account_id WHERE m.circle_id=$1 AND m.left_epoch IS NULL ORDER BY m.account_id LIMIT 20", id)
	if err != nil {
		return Details{}, auth.ErrUnavailable
	}
	defer rows.Close()
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.IntervalID, &m.AccountID, &m.PIN, &m.Role, &m.JoinedEpoch); err != nil {
			return Details{}, auth.ErrUnavailable
		}
		d.Members = append(d.Members, m)
	}
	if err := rows.Err(); err != nil {
		return Details{}, auth.ErrUnavailable
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return Details{}, auth.ErrUnavailable
	}
	return d, nil
}
func (s *Service) Invitations(ctx context.Context, actor auth.Principal, cursor string, limit int) (InvitationPage, error) {
	if limit < 1 || limit > 100 || (cursor != "" && !idPattern.MatchString(cursor)) {
		return InvitationPage{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return InvitationPage{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return InvitationPage{}, err
	}
	rows, err := tx.Query(ctx, `SELECT i.id,i.circle_id,i.inviter_id,i.invitee_id,i.status FROM circle_invites i JOIN circles c ON c.id=i.circle_id WHERE i.invitee_id=$1 AND i.id>$2 AND i.status='pending' AND i.expires_at>now() AND c.closed_at IS NULL AND EXISTS(SELECT 1 FROM circle_memberships m WHERE m.circle_id=c.id AND m.account_id=i.inviter_id AND m.role='admin' AND m.left_epoch IS NULL) AND EXISTS(SELECT 1 FROM friend_links f WHERE f.low_id=LEAST(i.inviter_id,i.invitee_id) AND f.high_id=GREATEST(i.inviter_id,i.invitee_id) AND f.status='accepted') AND NOT EXISTS(SELECT 1 FROM friend_blocks b WHERE (b.actor_id=i.inviter_id AND b.target_id=i.invitee_id) OR (b.actor_id=i.invitee_id AND b.target_id=i.inviter_id)) AND NOT EXISTS(SELECT 1 FROM circle_memberships m WHERE m.circle_id=c.id AND m.account_id=$1 AND m.left_epoch IS NULL) ORDER BY i.id LIMIT $3`, actor.AccountID, cursor, limit+1)
	if err != nil {
		return InvitationPage{}, auth.ErrUnavailable
	}
	defer rows.Close()
	page := InvitationPage{Items: make([]Invitation, 0, limit+1)}
	for rows.Next() {
		var i Invitation
		if err := rows.Scan(&i.ID, &i.CircleID, &i.InviterID, &i.InviteeID, &i.Status); err != nil {
			return InvitationPage{}, auth.ErrUnavailable
		}
		page.Items = append(page.Items, i)
	}
	if err := rows.Err(); err != nil {
		return InvitationPage{}, auth.ErrUnavailable
	}
	rows.Close()
	if len(page.Items) > limit {
		page.NextCursor = page.Items[limit-1].ID
		page.Items = page.Items[:limit]
	}
	if err := tx.Commit(ctx); err != nil {
		return InvitationPage{}, auth.ErrUnavailable
	}
	return page, nil
}
