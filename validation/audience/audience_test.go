package audience

import (
	"reflect"
	"testing"
)

func TestPromotionKeepsOriginalAudience(t *testing.T) {
	got := Recipients([]string{"alice", "bob"}, []string{"alice", "bob", "carol"})
	if !reflect.DeepEqual(got, []string{"alice", "bob"}) {
		t.Fatalf("new member exposed: %v", got)
	}
}

func TestReplyExcludesRemovedMembers(t *testing.T) {
	got := Recipients([]string{"alice", "bob", "carol"}, []string{"alice", "carol", "dave"})
	if !reflect.DeepEqual(got, []string{"alice", "carol"}) {
		t.Fatalf("wrong restricted reply audience: %v", got)
	}
}

func TestRecipientSetIsUniqueAndDoesNotAliasInput(t *testing.T) {
	original := []string{"alice", "alice", "bob"}
	got := Recipients(original, []string{"alice", "bob"})
	if !reflect.DeepEqual(got, []string{"alice", "bob"}) {
		t.Fatalf("duplicates: %v", got)
	}
	got[0] = "changed"
	if original[0] != "alice" {
		t.Fatal("input mutated")
	}
}
