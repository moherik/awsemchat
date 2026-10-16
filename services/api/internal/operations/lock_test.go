package operations

import "testing"

func TestAdvisoryKeyIsStableAndScopedToAccountGenerationOperation(t *testing.T) {
	key := advisoryKey("alice", 7, "message-one")
	if key != advisoryKey("alice", 7, "message-one") {
		t.Fatal("operation lock key is not deterministic")
	}
	if key == advisoryKey("alice", 8, "message-one") || key == advisoryKey("bob", 7, "message-one") || key == advisoryKey("alice", 7, "message-two") {
		t.Fatal("different operation owners share a lock key")
	}
}
