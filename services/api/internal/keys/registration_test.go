package keys

import (
	"awsemchat/services/api/internal/auth"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
	"time"
)

func registration(t *testing.T, actor auth.Principal, bundles []Bundle) Registration {
	t.Helper()
	wire := []byte("awsemchat.olm.account-publication\x00")
	wire = binary.BigEndian.AppendUint32(wire, 1)
	for _, value := range []string{actor.AccountID, actor.DeviceID} {
		wire = binary.BigEndian.AppendUint16(wire, uint16(len(value)))
		wire = append(wire, value...)
	}
	wire = binary.BigEndian.AppendUint64(wire, uint64(actor.Generation))
	wire = binary.BigEndian.AppendUint16(wire, uint16(len(bundles)))
	for _, b := range bundles {
		bytes := []byte(b.Context)
		bytes = append(bytes, 0)
		bytes = binary.BigEndian.AppendUint32(bytes, uint32(b.Version))
		for _, value := range []string{b.Identity, b.SigningIdentity, b.KeyID, b.Prekey} {
			decoded, err := base64.RawStdEncoding.DecodeString(value)
			if err != nil {
				t.Fatal(err)
			}
			bytes = append(bytes, decoded...)
		}
		bytes = binary.BigEndian.AppendUint64(bytes, uint64(b.IssuedAt))
		bytes = binary.BigEndian.AppendUint64(bytes, uint64(b.ExpiresAt))
		bytes = binary.BigEndian.AppendUint16(bytes, uint16(len(b.Publication)))
		bytes = append(bytes, b.Publication...)
		wire = binary.BigEndian.AppendUint32(wire, uint32(len(bytes)))
		wire = append(wire, bytes...)
		signature, err := base64.RawStdEncoding.DecodeString(b.Signature)
		if err != nil {
			t.Fatal(err)
		}
		wire = append(wire, signature...)
	}
	private := ed25519.NewKeyFromSeed([]byte(strings.Repeat("s", 32)))
	return Registration{Bundles: bundles, Proof: base64.RawStdEncoding.EncodeToString(ed25519.Sign(private, wire))}
}
func TestRegistrationProofBindsAccountDeviceGenerationAndSignedBatch(t *testing.T) {
	actor := auth.Principal{AccountID: "alice", DeviceID: "device-alice", Generation: 1}
	b := signed(t, nil)
	r := registration(t, actor, []Bundle{b})
	if err := r.Validate(actor, time.Unix(1000, 0)); err != nil {
		t.Fatalf("valid registration=%v, want nil", err)
	}
	for _, other := range []auth.Principal{{AccountID: "bob", DeviceID: actor.DeviceID, Generation: 1}, {AccountID: actor.AccountID, DeviceID: "other-phone", Generation: 1}, {AccountID: actor.AccountID, DeviceID: actor.DeviceID, Generation: 2}} {
		if err := r.Validate(other, time.Unix(1000, 0)); !errors.Is(err, ErrSignature) {
			t.Errorf("registration for changed binding=%v, want signature rejected", err)
		}
	}
	replacement := signed(t, func(b *Bundle) { b.Publication = "replacement" })
	changed := r
	changed.Bundles = []Bundle{replacement}
	if err := changed.Validate(actor, time.Unix(1000, 0)); !errors.Is(err, ErrSignature) {
		t.Fatalf("replaced batch=%v, want signature rejected", err)
	}
}
func TestRegistrationRejectsEmptyDuplicateAndMixedPublications(t *testing.T) {
	actor := auth.Principal{AccountID: "alice", DeviceID: "device-alice", Generation: 1}
	b := signed(t, nil)
	for _, bundles := range [][]Bundle{nil, {b, b}, {b, signed(t, func(b *Bundle) { b.Publication = "another" })}} {
		r := registration(t, actor, bundles)
		if err := r.Validate(actor, time.Unix(1000, 0)); !errors.Is(err, ErrInvalid) {
			t.Errorf("invalid batch=%v, want invalid", err)
		}
	}
	r := registration(t, actor, []Bundle{b})
	r.Proof += "=="
	if err := r.Validate(actor, time.Unix(1000, 0)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("padded proof=%v, want invalid", err)
	}
}
