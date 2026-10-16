package messages

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
)

var ErrInvalid = errors.New("invalid message envelope")

type PeerKeys struct {
	Identity        string `json:"identity"`
	SigningIdentity string `json:"signingIdentity"`
}
type Ciphertext struct {
	Kind int    `json:"kind"`
	Body string `json:"body"`
}
type Recipient struct {
	Peer    string     `json:"peer"`
	Keys    PeerKeys   `json:"keys"`
	Message Ciphertext `json:"message"`
}
type CollectionChange struct {
	Action string `json:"action"`
	Kind   string `json:"kind"`
	Item   string `json:"item"`
}

func (c *CollectionChange) UnmarshalJSON(raw []byte) error {
	type change CollectionChange
	var value change
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
		return ErrInvalid
	}
	*c = CollectionChange(value)
	return nil
}

type Envelope struct {
	CollectionSnapshot *CollectionSnapshot `json:"collectionSnapshot,omitempty"`
	CollectionRevision *int64              `json:"collectionRevision,omitempty"`
	CollectionChange   *CollectionChange   `json:"collectionChange,omitempty"`
	ProfileRevision    *int64              `json:"profileRevision,omitempty"`
	ContentType        string              `json:"contentType,omitempty"`
	Version            int                 `json:"version"`
	Operation          string              `json:"operation"`
	Conversation       string              `json:"conversation"`
	Audience           string              `json:"audience"`
	Sender             PeerKeys            `json:"sender"`
	Recipients         []Recipient         `json:"recipients"`
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func canonical(value string, size int) bool {
	decoded, err := base64.RawStdEncoding.Strict().DecodeString(value)
	return err == nil && len(decoded) == size && base64.RawStdEncoding.EncodeToString(decoded) == value
}
func validKeys(keys PeerKeys) bool {
	return canonical(keys.Identity, 32) && canonical(keys.SigningIdentity, 32)
}
func (c *Ciphertext) UnmarshalJSON(raw []byte) error {
	var value struct {
		Kind *int   `json:"kind"`
		Body string `json:"body"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || value.Kind == nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
		return ErrInvalid
	}
	c.Kind = *value.Kind
	c.Body = value.Body
	return nil
}
func DecodeEnvelope(raw string) (Envelope, error) {
	result := Envelope{}
	if len(raw) == 0 || len(raw) > 2*1024*1024 {
		return result, ErrInvalid
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil || !errors.Is(decoder.Decode(new(any)), io.EOF) {
		return Envelope{}, ErrInvalid
	}
	if result.Version != 1 || !identifier.MatchString(result.Operation) || !identifier.MatchString(result.Conversation) || !identifier.MatchString(result.Audience) || !validKeys(result.Sender) || result.Recipients == nil || (len(result.Recipients) == 0 && result.ContentType != "circle-profile" && result.ContentType != "circle-collection" && result.ContentType != "circle-collection-snapshot") || len(result.Recipients) > 19 {
		return Envelope{}, ErrInvalid
	}
	if result.ContentType != "" && result.ContentType != "text" && result.ContentType != "ping" && result.ContentType != "pong" && result.ContentType != "redaction-control" && result.ContentType != "private-profile" && result.ContentType != "now-playing" && result.ContentType != "circle-profile" && result.ContentType != "circle-member-profile" && result.ContentType != "circle-collection" && result.ContentType != "circle-collection-snapshot" {
		return Envelope{}, ErrInvalid
	}
	if result.ContentType == "circle-profile" {
		if result.ProfileRevision == nil || *result.ProfileRevision < 1 || *result.ProfileRevision > 9007199254740991 {
			return Envelope{}, ErrInvalid
		}
	} else if result.ProfileRevision != nil {
		return Envelope{}, ErrInvalid
	}
	if result.ContentType == "circle-collection" {
		change := result.CollectionChange
		if result.CollectionRevision == nil || *result.CollectionRevision < 1 || *result.CollectionRevision > 9007199254740991 || change == nil ||
			(change.Action != "add" && change.Action != "remove") || (change.Kind != "sticker" && change.Kind != "emoji") || !identifier.MatchString(change.Item) || change.Item == "." || change.Item == ".." {
			return Envelope{}, ErrInvalid
		}
	} else if result.ContentType == "circle-collection-snapshot" {
		if result.CollectionRevision == nil || *result.CollectionRevision < 0 || *result.CollectionRevision > 9007199254740991 || result.CollectionChange != nil || !validSnapshot(result.CollectionSnapshot) {
			return Envelope{}, ErrInvalid
		}
	} else if result.CollectionRevision != nil || result.CollectionChange != nil {
		return Envelope{}, ErrInvalid
	}
	if result.ContentType != "circle-collection-snapshot" && result.CollectionSnapshot != nil {
		return Envelope{}, ErrInvalid
	}
	peers := make(map[string]struct{}, len(result.Recipients))
	for _, recipient := range result.Recipients {
		if !identifier.MatchString(recipient.Peer) || !validKeys(recipient.Keys) || (recipient.Message.Kind != 0 && recipient.Message.Kind != 1) || len(recipient.Message.Body) == 0 || len(recipient.Message.Body) > 65536 {
			return Envelope{}, ErrInvalid
		}
		if _, exists := peers[recipient.Peer]; exists {
			return Envelope{}, ErrInvalid
		}
		peers[recipient.Peer] = struct{}{}
		decoded, err := base64.RawStdEncoding.Strict().DecodeString(recipient.Message.Body)
		if err != nil || len(decoded) == 0 || base64.RawStdEncoding.EncodeToString(decoded) != recipient.Message.Body {
			return Envelope{}, ErrInvalid
		}
	}
	return result, nil
}
