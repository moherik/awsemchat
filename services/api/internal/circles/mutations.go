package circles

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"

	"awsemchat/services/api/internal/auth"

	"github.com/jackc/pgx/v5"
)

var ErrOperationConflict = errors.New("circle operation conflict")
var ErrMembershipChanged = errors.New("circle membership changed")

type MembershipMutation struct {
	OperationID    string `json:"operationId"`
	Action         string `json:"action"`
	ActorInterval  string `json:"actorInterval"`
	ExpectedEpoch  int64  `json:"expectedEpoch"`
	TargetID       string `json:"targetId,omitempty"`
	TargetInterval string `json:"targetInterval,omitempty"`
}
type MembershipResult struct {
	OperationID string `json:"operationId"`
	CircleID    string `json:"circleId"`
	Action      string `json:"action"`
	Closed      bool   `json:"closed"`
	Cancelled   bool   `json:"cancelled,omitempty"`
}

func (s *Service) CancelMembership(ctx context.Context, actor auth.Principal, circleID string, input MembershipMutation) (MembershipResult, error) {
	return s.mutateMembership(ctx, actor, circleID, input, true)
}

func (s *Service) MutateMembership(ctx context.Context, actor auth.Principal, circleID string, input MembershipMutation) (MembershipResult, error) {
	return s.mutateMembership(ctx, actor, circleID, input, false)
}
func (s *Service) mutateMembership(ctx context.Context, actor auth.Principal, circleID string, input MembershipMutation, cancel bool) (MembershipResult, error) {
	result := MembershipResult{OperationID: input.OperationID, CircleID: circleID, Action: input.Action}
	if !idPattern.MatchString(circleID) || !idPattern.MatchString(input.OperationID) || !idPattern.MatchString(input.ActorInterval) || input.ExpectedEpoch < 1 || input.ExpectedEpoch > 9007199254740991 {
		return MembershipResult{}, ErrInvalid
	}
	switch input.Action {
	case "leave":
		if input.TargetID != "" || input.TargetInterval != "" {
			return MembershipResult{}, ErrInvalid
		}
	case "remove", "handoff":
		if !idPattern.MatchString(input.TargetID) || !idPattern.MatchString(input.TargetInterval) || input.TargetID == actor.AccountID {
			return MembershipResult{}, ErrInvalid
		}
	default:
		return MembershipResult{}, ErrInvalid
	}
	raw, _ := json.Marshal(input)
	digest := sha256.Sum256(raw)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MembershipResult{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return MembershipResult{}, err
	}
	var epoch int64
	var closed bool
	err = tx.QueryRow(ctx, "SELECT epoch,closed_at IS NOT NULL FROM circles WHERE id=$1 FOR UPDATE", circleID).Scan(&epoch, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return MembershipResult{}, ErrDenied
	}
	if err != nil {
		return MembershipResult{}, auth.ErrUnavailable
	}
	var saved []byte
	err = tx.QueryRow(ctx, "SELECT request_digest,closed,cancelled FROM circle_membership_operations WHERE circle_id=$1 AND actor_id=$2 AND operation_id=$3", circleID, actor.AccountID, input.OperationID).Scan(&saved, &result.Closed, &result.Cancelled)
	if err == nil {
		if !bytes.Equal(saved, digest[:]) {
			return MembershipResult{}, ErrOperationConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return MembershipResult{}, auth.ErrUnavailable
		}
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return MembershipResult{}, auth.ErrUnavailable
	}
	if cancel {
		result.Cancelled = true
		return recordMembershipResult(ctx, tx, actor, input, digest, result)
	}
	if closed {
		return MembershipResult{}, ErrDenied
	}
	if epoch != input.ExpectedEpoch {
		return MembershipResult{}, ErrMembershipChanged
	}
	var interval string
	err = tx.QueryRow(ctx, "SELECT id FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND left_epoch IS NULL", circleID, actor.AccountID).Scan(&interval)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && interval != input.ActorInterval {
		return MembershipResult{}, ErrMembershipChanged
	}
	if err != nil {
		return MembershipResult{}, auth.ErrUnavailable
	}
	if input.TargetID != "" {
		err = tx.QueryRow(ctx, "SELECT id FROM circle_memberships WHERE circle_id=$1 AND account_id=$2 AND left_epoch IS NULL", circleID, input.TargetID).Scan(&interval)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && interval != input.TargetInterval {
			return MembershipResult{}, ErrMembershipChanged
		}
		if err != nil {
			return MembershipResult{}, auth.ErrUnavailable
		}
	}
	if err := s.membershipTx(ctx, tx, actor, circleID, input.Action, input.TargetID); err != nil {
		return MembershipResult{}, err
	}
	if err := tx.QueryRow(ctx, "SELECT closed_at IS NOT NULL FROM circles WHERE id=$1", circleID).Scan(&result.Closed); err != nil {
		return MembershipResult{}, auth.ErrUnavailable
	}
	return recordMembershipResult(ctx, tx, actor, input, digest, result)
}
func recordMembershipResult(ctx context.Context, tx pgx.Tx, actor auth.Principal, input MembershipMutation, digest [32]byte, result MembershipResult) (MembershipResult, error) {
	if _, err := tx.Exec(ctx, "INSERT INTO circle_membership_operations(circle_id,actor_id,operation_id,request_digest,action,closed,cancelled) VALUES($1,$2,$3,$4,$5,$6,$7)", result.CircleID, actor.AccountID, input.OperationID, digest[:], input.Action, result.Closed, result.Cancelled); err != nil {
		return MembershipResult{}, auth.ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return MembershipResult{}, auth.ErrUnavailable
	}
	return result, nil
}
func (s *Service) membershipTx(ctx context.Context, tx pgx.Tx, actor auth.Principal, circleID, action, target string) error {
	switch action {
	case "leave":
		return s.leaveTx(ctx, tx, actor, circleID)
	case "remove":
		return s.removeTx(ctx, tx, actor, circleID, target)
	case "handoff":
		return s.handoffTx(ctx, tx, actor, circleID, target)
	default:
		return ErrInvalid
	}
}
func (s *Service) legacyMembership(ctx context.Context, actor auth.Principal, circleID, action, target string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return err
	}
	if err := s.membershipTx(ctx, tx, actor, circleID, action, target); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.ErrUnavailable
	}
	return nil
}
