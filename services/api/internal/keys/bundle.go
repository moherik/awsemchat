package keys

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"regexp"
	"time"
)

var ErrInvalid = errors.New("invalid public key bundle")
var ErrSignature = errors.New("public key signature rejected")
var ErrExpired = errors.New("public key bundle expired")

type Bundle struct {
	Version         int    `json:"version"`
	Context         string `json:"context"`
	Publication     string `json:"publication"`
	KeyID           string `json:"keyId"`
	Identity        string `json:"identity"`
	SigningIdentity string `json:"signingIdentity"`
	Prekey          string `json:"prekey"`
	IssuedAt        int64  `json:"issuedAt"`
	ExpiresAt       int64  `json:"expiresAt"`
	Signature       string `json:"signature"`
}

func (b Bundle) Validate(now time.Time) error {
	wire, signing, signature, err := b.canonical()
	if err != nil {
		return err
	}
	if !ed25519.Verify(signing, wire, signature) {
		return ErrSignature
	}
	if b.IssuedAt > 9007199254740991-604800 || b.ExpiresAt != b.IssuedAt+604800 || now.Unix() < b.IssuedAt || now.Unix() >= b.ExpiresAt {
		return ErrExpired
	}
	return nil
}
func (b Bundle) canonical() ([]byte, []byte, []byte, error) {
	if b.Version != 1 || b.Context != "awsemchat.olm.signed-prekey" || !publicationPattern.MatchString(b.Publication) || b.IssuedAt < 0 || b.ExpiresAt < 0 {
		return nil, nil, nil, ErrInvalid
	}
	wire := []byte(b.Context)
	wire = append(wire, 0)
	wire = binary.BigEndian.AppendUint32(wire, uint32(b.Version))
	var signing []byte
	for i, field := range []struct {
		value string
		size  int
	}{{b.Identity, 32}, {b.SigningIdentity, 32}, {b.KeyID, 8}, {b.Prekey, 32}} {
		decoded, err := base64.RawStdEncoding.DecodeString(field.value)
		if err != nil || len(decoded) != field.size || base64.RawStdEncoding.EncodeToString(decoded) != field.value {
			return nil, nil, nil, ErrInvalid
		}
		wire = append(wire, decoded...)
		if i == 1 {
			signing = decoded
		}
	}
	signature, err := base64.RawStdEncoding.DecodeString(b.Signature)
	if err != nil || len(signature) != 64 || base64.RawStdEncoding.EncodeToString(signature) != b.Signature {
		return nil, nil, nil, ErrInvalid
	}
	wire = binary.BigEndian.AppendUint64(wire, uint64(b.IssuedAt))
	wire = binary.BigEndian.AppendUint64(wire, uint64(b.ExpiresAt))
	wire = binary.BigEndian.AppendUint16(wire, uint16(len(b.Publication)))
	wire = append(wire, []byte(b.Publication)...)
	return wire, signing, signature, nil
}

var publicationPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
