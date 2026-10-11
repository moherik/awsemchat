package keys

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func signed(t *testing.T, change func(*Bundle)) Bundle {
	t.Helper()
	private := ed25519.NewKeyFromSeed([]byte(strings.Repeat("s", 32)))
	b := Bundle{Version: 1, Context: "awsemchat.olm.signed-prekey", Publication: "publication-one", KeyID: base64.RawStdEncoding.EncodeToString([]byte("key-id-1")), Identity: base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("i", 32))), SigningIdentity: base64.RawStdEncoding.EncodeToString(private.Public().(ed25519.PublicKey)), Prekey: base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("p", 32))), IssuedAt: 1000, ExpiresAt: 1000 + 604800}
	if change != nil {
		change(&b)
	}
	wire := []byte(b.Context)
	wire = append(wire, 0)
	wire = binary.BigEndian.AppendUint32(wire, uint32(b.Version))
	for _, value := range []string{b.Identity, b.SigningIdentity, b.KeyID, b.Prekey} {
		decoded, err := base64.RawStdEncoding.DecodeString(value)
		if err != nil {
			t.Fatal(err)
		}
		wire = append(wire, decoded...)
	}
	wire = binary.BigEndian.AppendUint64(wire, uint64(b.IssuedAt))
	wire = binary.BigEndian.AppendUint64(wire, uint64(b.ExpiresAt))
	wire = binary.BigEndian.AppendUint16(wire, uint16(len(b.Publication)))
	wire = append(wire, []byte(b.Publication)...)
	b.Signature = base64.RawStdEncoding.EncodeToString(ed25519.Sign(private, wire))
	return b
}
func TestSignedBundleMatchesNativeCanonicalWireAndExpiryBoundaries(t *testing.T) {
	b := signed(t, nil)
	if err := b.Validate(time.Unix(1000, 0)); err != nil {
		t.Fatalf("valid signed bundle=%v", err)
	}
	for _, now := range []int64{999, 605800} {
		if err := b.Validate(time.Unix(now, 0)); !errors.Is(err, ErrExpired) {
			t.Fatalf("expired at %d=%v", now, err)
		}
	}
	invalidLifetime := signed(t, func(b *Bundle) { b.ExpiresAt++ })
	if err := invalidLifetime.Validate(time.Unix(1000, 0)); !errors.Is(err, ErrExpired) {
		t.Fatalf("signed lifetime accepted=%v", err)
	}
}
func TestBundleRejectsTamperedSignedFieldsAndAlternateEncodings(t *testing.T) {
	for _, field := range []string{"publication", "keyId", "prekey", "identity", "signingIdentity", "signature", "issuedAt", "expiresAt"} {
		t.Run(field, func(t *testing.T) {
			b := signed(t, nil)
			switch field {
			case "publication":
				b.Publication = "another"
			case "keyId":
				b.KeyID = base64.RawStdEncoding.EncodeToString([]byte("key-id-2"))
			case "prekey":
				b.Prekey = b.Identity
			case "identity":
				b.Identity = b.Prekey
			case "signingIdentity":
				b.SigningIdentity = b.Identity
			case "signature":
				b.Signature = base64.RawStdEncoding.EncodeToString(make([]byte, 64))
			case "issuedAt":
				b.IssuedAt++
			case "expiresAt":
				b.ExpiresAt++
			}
			if err := b.Validate(time.Unix(1001, 0)); !errors.Is(err, ErrSignature) {
				t.Fatalf("tampered %s=%v", field, err)
			}
		})
	}
	for _, change := range []func(*Bundle){func(b *Bundle) { b.Identity += "=" }, func(b *Bundle) { b.KeyID = "short" }, func(b *Bundle) { b.Signature = "private-invalid" }, func(b *Bundle) { b.Publication = "invalid publication" }, func(b *Bundle) { b.Version = 2 }, func(b *Bundle) { b.Context = "other" }} {
		b := signed(t, nil)
		change(&b)
		if err := b.Validate(time.Unix(1000, 0)); !errors.Is(err, ErrInvalid) {
			t.Fatalf("malformed bundle=%v", err)
		}
	}
}

func TestNativeRustPublicationFixtureVerifiesInGo(t *testing.T) {
	raw, err := os.ReadFile("testdata/native-publication.json")
	if err != nil {
		t.Fatal(err)
	}
	var publication struct {
		Bundles []Bundle `json:"bundles"`
	}
	if err := json.Unmarshal(raw, &publication); err != nil {
		t.Fatal(err)
	}
	if len(publication.Bundles) != 20 {
		t.Fatalf("native publication bundles=%d, want20", len(publication.Bundles))
	}
	for n, b := range publication.Bundles {
		if err := b.Validate(time.Unix(b.IssuedAt, 0)); err != nil {
			t.Errorf("native bundle[%d].Validate=%v, want nil", n, err)
		}
		b.Publication = "tampered"
		if err := b.Validate(time.Unix(b.IssuedAt, 0)); !errors.Is(err, ErrSignature) {
			t.Errorf("tampered native bundle[%d]=%v, want signature rejected", n, err)
		}
	}
}
