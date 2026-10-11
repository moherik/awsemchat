package keys

import (
	"awsemchat/services/api/internal/auth"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"time"
)

type Registration struct {
	Bundles []Bundle `json:"bundles"`
	Proof   string   `json:"proof"`
}

func (r Registration) Validate(actor auth.Principal, now time.Time) error {
	if !publicationPattern.MatchString(actor.AccountID) || !publicationPattern.MatchString(actor.DeviceID) || actor.Generation < 1 || actor.Generation > 9007199254740991 || len(r.Bundles) < 1 || len(r.Bundles) > 20 {
		return ErrInvalid
	}
	proof, err := base64.RawStdEncoding.DecodeString(r.Proof)
	if err != nil || len(proof) != 64 || base64.RawStdEncoding.EncodeToString(proof) != r.Proof {
		return ErrInvalid
	}
	wire := []byte("awsemchat.olm.account-publication\x00")
	wire = binary.BigEndian.AppendUint32(wire, 1)
	for _, value := range []string{actor.AccountID, actor.DeviceID} {
		wire = binary.BigEndian.AppendUint16(wire, uint16(len(value)))
		wire = append(wire, value...)
	}
	wire = binary.BigEndian.AppendUint64(wire, uint64(actor.Generation))
	wire = binary.BigEndian.AppendUint16(wire, uint16(len(r.Bundles)))
	first := r.Bundles[0]
	seenIDs := make(map[string]struct{}, len(r.Bundles))
	seenKeys := make(map[string]struct{}, len(r.Bundles))
	var signing []byte
	for _, bundle := range r.Bundles {
		if bundle.Identity != first.Identity || bundle.SigningIdentity != first.SigningIdentity || bundle.Publication != first.Publication {
			return ErrInvalid
		}
		if _, exists := seenIDs[bundle.KeyID]; exists {
			return ErrInvalid
		}
		if _, exists := seenKeys[bundle.Prekey]; exists {
			return ErrInvalid
		}
		seenIDs[bundle.KeyID] = struct{}{}
		seenKeys[bundle.Prekey] = struct{}{}
		if err := bundle.Validate(now); err != nil {
			return err
		}
		bytes, key, signature, err := bundle.canonical()
		if err != nil {
			return err
		}
		signing = key
		wire = binary.BigEndian.AppendUint32(wire, uint32(len(bytes)))
		wire = append(wire, bytes...)
		wire = append(wire, signature...)
	}
	if !ed25519.Verify(signing, wire, proof) {
		return ErrSignature
	}
	return nil
}
