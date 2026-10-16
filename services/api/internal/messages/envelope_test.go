package messages

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func wire(t *testing.T) string {
	t.Helper()
	key := base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))
	value := map[string]any{"version": 1, "operation": "message-one", "conversation": "room-one", "audience": "audience-one", "sender": map[string]string{"identity": key, "signingIdentity": key}, "recipients": []any{map[string]any{"peer": "bob", "keys": map[string]string{"identity": key, "signingIdentity": key}, "message": map[string]any{"kind": 0, "body": base64.RawStdEncoding.EncodeToString([]byte("synthetic opaque ciphertext"))}}}}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func TestDecodeNativeEnvelopePreservesRoutingAndOpaqueCiphertext(t *testing.T) {
	e, err := DecodeEnvelope(wire(t))
	if err != nil {
		t.Fatal(err)
	}
	if e.Operation != "message-one" || e.Conversation != "room-one" || e.Audience != "audience-one" || len(e.Recipients) != 1 || e.Recipients[0].Peer != "bob" || e.Recipients[0].Message.Kind != 0 || e.Recipients[0].Message.Body != "c3ludGhldGljIG9wYXF1ZSBjaXBoZXJ0ZXh0" {
		t.Fatalf("unexpected envelope=%+v", e)
	}
}

func TestDecodePrivateProfileKeepsFieldsEncryptedInsideTheOpaqueEvent(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal([]byte(wire(t)), &value); err != nil {
		t.Fatal(err)
	}
	value["contentType"] = "private-profile"
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := DecodeEnvelope(string(raw))
	if err != nil {
		t.Fatalf("DecodeEnvelope(private profile) = %v; want opaque typed envelope", err)
	}
	if envelope.ContentType != "private-profile" || len(envelope.Recipients) != 1 || strings.Contains(string(raw), `"name"`) {
		t.Fatalf("private profile envelope exposed metadata or changed type: %s", raw)
	}
}

func TestDecodePingAndPongAreExplicitPrivateConversationTypes(t *testing.T) {
	for _, kind := range []string{"ping", "pong"} {
		var value map[string]any
		if err := json.Unmarshal([]byte(wire(t)), &value); err != nil { t.Fatal(err) }
		value["contentType"] = kind
		raw, _ := json.Marshal(value)
		envelope, err := DecodeEnvelope(string(raw))
		if err != nil || envelope.ContentType != kind { t.Fatalf("DecodeEnvelope(%s) = %+v, %v", kind, envelope, err) }
	}
}

func TestDecodeCircleMemberProfileCarriesNoPlaintextProfileFields(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal([]byte(wire(t)), &value); err != nil { t.Fatal(err) }
	value["contentType"] = "circle-member-profile"
	raw, _ := json.Marshal(value)
	envelope, err := DecodeEnvelope(string(raw))
	if err != nil || envelope.ContentType != "circle-member-profile" || strings.Contains(string(raw), `"status"`) || strings.Contains(string(raw), `"name"`) {
		t.Fatalf("DecodeEnvelope(Circle member profile) = %+v,%v; profile data must remain encrypted", envelope, err)
	}
}

func TestDecodeNowPlayingCarriesOnlyOpaqueCiphertext(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal([]byte(wire(t)), &value); err != nil { t.Fatal(err) }
	value["contentType"] = "now-playing"
	raw, err := json.Marshal(value)
	if err != nil { t.Fatal(err) }
	envelope, err := DecodeEnvelope(string(raw))
	if err != nil || envelope.ContentType != "now-playing" || strings.Contains(string(raw), `"title"`) || strings.Contains(string(raw), `"artist"`) {
		t.Fatalf("DecodeEnvelope(Now Playing) = %+v,%v; metadata must remain encrypted", envelope, err)
	}
}

func TestDecodeEnvelopeRejectsUnknownPlaintextFieldsMalformedKeysAndRecipients(t *testing.T) {
	raw := wire(t)
	cases := []string{`null`, raw + ` {}`, strings.Replace(raw, `"version":1`, `"version":2`, 1), strings.Replace(raw, `"operation":"message-one"`, `"operation":"bad id"`, 1), strings.Replace(raw, `"kind":0`, `"kind":2`, 1), strings.Replace(raw, `"peer":"bob"`, `"peer":""`, 1), strings.Replace(raw, `"body":`, `"plaintext":"secret","body":`, 1), strings.Replace(raw, `"recipients":[`, `"recipients":[],"extra":[`, 1), strings.Repeat(" ", 2*1024*1024) + raw}
	cases = append(cases, strings.Replace(raw, `"kind":0`, `"kind":null`, 1), strings.Replace(raw, `,"kind":0`, ``, 1), strings.Replace(raw, `c3ludGhldGljIG9wYXF1ZSBjaXBoZXJ0ZXh0`, `Zg==`, 1), strings.Replace(raw, `c3ludGhldGljIG9wYXF1ZSBjaXBoZXJ0ZXh0`, `Zh`, 1))
	for _, input := range cases {
		if _, err := DecodeEnvelope(input); !errors.Is(err, ErrInvalid) {
			t.Errorf("invalid envelope accepted: %v", err)
		}
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatal(err)
	}
	recipients := value["recipients"].([]any)
	value["recipients"] = append(recipients, recipients[0])
	duplicate, _ := json.Marshal(value)
	if _, err := DecodeEnvelope(string(duplicate)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate peer=%v", err)
	}
	value["recipients"] = recipients
	value["sender"].(map[string]any)["identity"] = "not-a-key"
	malformed, _ := json.Marshal(value)
	if _, err := DecodeEnvelope(string(malformed)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("malformed key=%v", err)
	}
}
