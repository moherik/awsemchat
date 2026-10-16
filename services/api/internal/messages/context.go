package messages

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"

	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/friends"
	"awsemchat/services/api/internal/keys"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrDenied = errors.New("message audience denied")

type Service struct {
	pool *pgxpool.Pool
	auth *auth.Service
}

func NewService(pool *pgxpool.Pool, identity *auth.Service) *Service {
	return &Service{pool: pool, auth: identity}
}

type ContextInput struct {
	TargetID string `json:"targetId,omitempty"`
	CircleID string `json:"circleId,omitempty"`
}
type RecipientBinding struct {
	AccountID  string   `json:"accountId"`
	Generation int64    `json:"generation"`
	Keys       PeerKeys `json:"keys"`
	IntervalID string   `json:"intervalId,omitempty"`
}
type ConversationContext struct {
	CollectionRevision *int64             `json:"collectionRevision,omitempty"`
	ProfileRevision    *int64             `json:"profileRevision,omitempty"`
	Conversation       string             `json:"conversation"`
	Audience           string             `json:"audience"`
	Sender             PeerKeys           `json:"sender"`
	Recipients         []RecipientBinding `json:"recipients"`
	Epoch              int64              `json:"epoch,omitempty"`
	CircleID           string             `json:"circleId,omitempty"`
}

func (s *Service) Context(ctx context.Context, actor auth.Principal, input ContextInput) (ConversationContext, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ConversationContext{}, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	result, err := s.context(ctx, tx, actor, input)
	if err != nil {
		return result, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ConversationContext{}, auth.ErrUnavailable
	}
	return result, nil
}
func (s *Service) context(ctx context.Context, tx pgx.Tx, actor auth.Principal, input ContextInput) (ConversationContext, error) {
	result := ConversationContext{Recipients: []RecipientBinding{}}
	if (input.TargetID == "") == (input.CircleID == "") {
		return result, ErrInvalid
	}
	if err := s.auth.LockSession(ctx, tx, actor); err != nil {
		return result, err
	}
	peers := []circles.AudienceMember{}
	if input.TargetID != "" {
		if !identifier.MatchString(input.TargetID) || input.TargetID == actor.AccountID {
			return result, ErrInvalid
		}
		request, err := friends.NewService(s.pool, s.auth).AcceptedRequest(ctx, tx, actor, input.TargetID)
		if errors.Is(err, friends.ErrDenied) {
			return result, ErrDenied
		}
		if err != nil {
			return result, err
		}
		result.Conversation = PrivateConversationID(actor.AccountID, input.TargetID)
		result.Audience = "friend:" + request
		peers = append(peers, circles.AudienceMember{AccountID: input.TargetID})
	} else {
		audience, err := circles.NewService(s.pool, s.auth).CurrentAudience(ctx, tx, actor, input.CircleID)
		if errors.Is(err, circles.ErrDenied) {
			return result, ErrDenied
		}
		if err != nil {
			return result, err
		}
		result.Conversation = input.CircleID
		var profileRevision, collectionRevision int64
		if err := tx.QueryRow(ctx, "SELECT profile_revision,collection_revision FROM circles WHERE id=$1", input.CircleID).Scan(&profileRevision, &collectionRevision); err != nil {
			return result, auth.ErrUnavailable
		}
		result.ProfileRevision = &profileRevision
		result.CollectionRevision = &collectionRevision
		result.CircleID = input.CircleID
		result.Epoch = audience.Epoch
		result.Audience = "circle:" + strconv.FormatInt(audience.Epoch, 10)
		for _, member := range audience.Members {
			if member.AccountID != actor.AccountID {
				peers = append(peers, member)
			}
		}
	}
	directory := keys.NewService(s.pool, s.auth)
	sender, err := directory.LockIdentity(ctx, tx, actor.AccountID)
	if err != nil {
		return result, err
	}
	result.Sender = PeerKeys{Identity: sender.Identity, SigningIdentity: sender.SigningIdentity}
	if !validKeys(result.Sender) {
		return result, auth.ErrUnavailable
	}
	for _, peer := range peers {
		identity, err := directory.LockIdentity(ctx, tx, peer.AccountID)
		if err != nil {
			return result, err
		}
		public := PeerKeys{Identity: identity.Identity, SigningIdentity: identity.SigningIdentity}
		if !validKeys(public) {
			return result, auth.ErrUnavailable
		}
		result.Recipients = append(result.Recipients, RecipientBinding{AccountID: peer.AccountID, Generation: identity.Generation, Keys: public, IntervalID: peer.IntervalID})
	}
	return result, nil
}

// PrivateConversationID returns the stable identifier for a pair of accounts.
func PrivateConversationID(first, second string) string {
	low, high := first, second
	if low > high {
		low, high = high, low
	}
	raw, _ := json.Marshal([]string{"awsemchat.private.v1", low, high})
	digest := sha256.Sum256(raw)
	return "private:" + hex.EncodeToString(digest[:])
}
