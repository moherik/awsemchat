package circles

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMembershipOperationRetryCannotLeaveAReplacementInterval(t *testing.T) {
	s, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := s.Create(ctx, actor, "membership-create")
	if err != nil {
		t.Fatal(err)
	}
	details, err := s.Details(ctx, actor, circle.ID)
	if err != nil {
		t.Fatal(err)
	}
	input := MembershipMutation{OperationID: "leave-original", Action: "leave", ActorInterval: details.Members[0].IntervalID, ExpectedEpoch: circle.Epoch}
	result, err := s.MutateMembership(ctx, actor, circle.ID, input)
	if err != nil || !result.Closed {
		t.Fatalf("MutateMembership(leave)=%+v,%v, want closed", result, err)
	}
	retry, err := s.MutateMembership(ctx, actor, circle.ID, input)
	if err != nil || retry != result {
		t.Fatalf("MutateMembership(retry)=%+v,%v, want %+v", retry, err, result)
	}
	var epoch int64
	if err := pool.QueryRow(ctx, "SELECT epoch FROM circles WHERE id=$1", circle.ID).Scan(&epoch); err != nil {
		t.Fatal(err)
	}
	if epoch != 2 {
		t.Fatalf("leave retry epoch=%d, want2", epoch)
	}
	changed := input
	changed.ExpectedEpoch = 2
	if _, err := s.MutateMembership(ctx, actor, circle.ID, changed); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("changed operation=%v, want conflict", err)
	}
}

func TestMembershipHTTPExposesExactOperationAndRejectsUnknownFields(t *testing.T) {
	s, _, actor := fixture(t)
	ctx := context.Background()
	circle, err := s.Create(ctx, actor, "http-op-create")
	if err != nil {
		t.Fatal(err)
	}
	details, err := s.Details(ctx, actor, circle.ID)
	if err != nil {
		t.Fatal(err)
	}
	input := MembershipMutation{OperationID: "http-leave", Action: "leave", ActorInterval: details.Members[0].IntervalID, ExpectedEpoch: 1}
	raw, _ := json.Marshal(input)
	handler := NewHandler(s)
	call := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/v1/circles/"+circle.ID+"/membership-operations", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+tokenFor("alice"))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call(strings.TrimSuffix(string(raw), "}") + `,"actorId":"bob"}`); w.Code != 400 {
		t.Fatalf("spoofed operation HTTP=%d,want400", w.Code)
	}
	for range 2 {
		w := call(string(raw))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"closed":true`) {
			t.Fatalf("membership HTTP=%d %s,want closed200", w.Code, w.Body.String())
		}
	}
}

func TestRemovalRetryDoesNotRemoveRejoinedMember(t *testing.T) {
	s, pool, actor := fixture(t)
	ctx := context.Background()
	bob := addActor(t, pool, "bob", true)
	circle, err := s.Create(ctx, actor, "remove-op-create")
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := s.Invite(ctx, actor, circle.ID, bob.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	joined, err := s.Respond(ctx, bob, invitation.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	details, err := s.Details(ctx, actor, circle.ID)
	if err != nil {
		t.Fatal(err)
	}
	var own string
	for _, member := range details.Members {
		if member.AccountID == actor.AccountID {
			own = member.IntervalID
		}
	}
	input := MembershipMutation{OperationID: "remove-original", Action: "remove", ActorInterval: own, ExpectedEpoch: details.Epoch, TargetID: bob.AccountID, TargetInterval: joined.IntervalID}
	if _, err := s.MutateMembership(ctx, actor, circle.ID, input); err != nil {
		t.Fatal(err)
	}
	invitation, err = s.Invite(ctx, actor, circle.ID, bob.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	rejoined, err := s.Respond(ctx, bob, invitation.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.MutateMembership(ctx, actor, circle.ID, input); err != nil {
		t.Fatal(err)
	}
	current, err := s.Details(ctx, bob, circle.ID)
	if err != nil || current.MemberCount != 2 {
		t.Fatalf("remove retry ended replacement interval: %+v,%v", current, err)
	}
	input.OperationID = "stale-new-removal"
	input.ExpectedEpoch = current.Epoch
	if _, err := s.MutateMembership(ctx, actor, circle.ID, input); !errors.Is(err, ErrMembershipChanged) {
		t.Fatalf("stale target interval=%v,want membership changed", err)
	}
	if rejoined.IntervalID == joined.IntervalID {
		t.Fatal("rejoin did not create fresh interval")
	}
}

func TestMembershipOperationRejectsStaleOrForgedActorInterval(t *testing.T) {
	s, _, actor := fixture(t)
	ctx := context.Background()
	circle, err := s.Create(ctx, actor, "membership-create")
	if err != nil {
		t.Fatal(err)
	}
	details, err := s.Details(ctx, actor, circle.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []MembershipMutation{
		{OperationID: "stale", Action: "leave", ActorInterval: details.Members[0].IntervalID, ExpectedEpoch: 2},
		{OperationID: "forged", Action: "leave", ActorInterval: "another-interval", ExpectedEpoch: 1},
	} {
		if _, err := s.MutateMembership(ctx, actor, circle.ID, input); !errors.Is(err, ErrMembershipChanged) {
			t.Fatalf("MutateMembership(%s)=%v,want membership changed", input.OperationID, err)
		}
	}
	current, err := s.Details(ctx, actor, circle.ID)
	if err != nil || current.MemberCount != 1 {
		t.Fatalf("rejected leave details=%+v,%v", current, err)
	}
}
func TestCancelMembershipFencesLateMutationAndNeverUndoesCommittedLeave(t *testing.T) {
	s, _, actor := fixture(t)
	ctx := context.Background()
	circle, err := s.Create(ctx, actor, "cancel-create")
	if err != nil {
		t.Fatal(err)
	}
	details, err := s.Details(ctx, actor, circle.ID)
	if err != nil {
		t.Fatal(err)
	}
	input := MembershipMutation{OperationID: "cancel-before", Action: "leave", ActorInterval: details.Members[0].IntervalID, ExpectedEpoch: 1}
	cancelled, err := s.CancelMembership(ctx, actor, circle.ID, input)
	if err != nil || !cancelled.Cancelled || cancelled.Closed {
		t.Fatalf("CancelMembership=%+v,%v,want cancelled not closed", cancelled, err)
	}
	late, err := s.MutateMembership(ctx, actor, circle.ID, input)
	if err != nil || late != cancelled {
		t.Fatalf("late mutate=%+v,%v,want cancelled", late, err)
	}
	current, err := s.Details(ctx, actor, circle.ID)
	if err != nil || current.MemberCount != 1 {
		t.Fatalf("cancelled leave changed membership=%+v,%v", current, err)
	}
	input.OperationID = "committed-first"
	committed, err := s.MutateMembership(ctx, actor, circle.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	after, err := s.CancelMembership(ctx, actor, circle.ID, input)
	if err != nil || after != committed || after.Cancelled {
		t.Fatalf("cancel after commit=%+v,%v,want original applied result", after, err)
	}
}
func TestConcurrentMembershipCancelAndCommitHaveOneConsistentOutcome(t *testing.T) {
	s, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := s.Create(ctx, actor, "cancel-race-create")
	if err != nil {
		t.Fatal(err)
	}
	details, err := s.Details(ctx, actor, circle.ID)
	if err != nil {
		t.Fatal(err)
	}
	input := MembershipMutation{OperationID: "cancel-race", Action: "leave", ActorInterval: details.Members[0].IntervalID, ExpectedEpoch: 1}
	type outcome struct {
		result MembershipResult
		err    error
	}
	done := make(chan outcome, 2)
	start := make(chan struct{})
	go func() {
		<-start
		value, err := s.CancelMembership(ctx, actor, circle.ID, input)
		done <- outcome{value, err}
	}()
	go func() {
		<-start
		value, err := s.MutateMembership(ctx, actor, circle.ID, input)
		done <- outcome{value, err}
	}()
	close(start)
	first, second := <-done, <-done
	if first.err != nil || second.err != nil || first.result != second.result {
		t.Fatalf("cancel/commit outcomes=%+v,%+v,want identical successful outcome", first, second)
	}
	var count int
	var closed bool
	if err := pool.QueryRow(ctx, "SELECT member_count,closed_at IS NOT NULL FROM circles WHERE id=$1", circle.ID).Scan(&count, &closed); err != nil {
		t.Fatal(err)
	}
	if first.result.Cancelled {
		if count != 1 || closed {
			t.Fatalf("cancelled result count=%d closed=%v,want1,false", count, closed)
		}
	} else if count != 0 || !closed {
		t.Fatalf("committed result count=%d closed=%v,want0,true", count, closed)
	}
}
