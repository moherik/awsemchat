package media

import (
	"awsemchat/services/api/internal/auth"
	"awsemchat/services/api/internal/circles"
	"awsemchat/services/api/internal/messages"
	"awsemchat/services/api/migrations"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixture(t *testing.T) (*Service, *circles.Service, *pgxpool.Pool, auth.Principal) {
	t.Helper()
	url := os.Getenv("AWSEM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("real PostgreSQL fixture required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "media_test_" + rand.Text()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	identity, err := auth.NewService(pool, auth.NewDevelopmentSMS(time.Now), auth.Config{Pepper: []byte(strings.Repeat("p", 32))})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("alice"))
	expiry := time.Now().Add(time.Hour)
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('alice',$1,'ABCDEFGH',1)", digest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-alice','alice','device-alice',1,$1,now(),$2)", mediaTokenDigest(), expiry); err != nil {
		t.Fatal(err)
	}
	publicKey := base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	if _, err := pool.Exec(ctx, "INSERT INTO key_identities(account_id,generation,device_id,identity,signing_identity) VALUES('alice',1,'device-alice',$1,$1)", publicKey); err != nil {
		t.Fatal(err)
	}
	store, err := NewLocalStore(t.TempDir() + "/private")
	if err != nil {
		t.Fatal(err)
	}
	return NewService(pool, identity, store), circles.NewService(pool, identity), pool, auth.Principal{SessionID: "session-alice", AccountID: "alice", DeviceID: "device-alice", Generation: 1, ExpiresAt: expiry}
}

func TestCircleMediaNeverGrantsOldObjectsToNewIntervals(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "media-circle")
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("opaque ciphertext")
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "old-object", "media-operation", body); err != nil {
		t.Fatal(err)
	}
	expiry := time.Now().Add(time.Hour)
	digest := sha256.Sum256([]byte("bob"))
	_, err = pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',$1,'BCDEFGHJ',1)", digest[:])
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, "INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-bob','bob','device-bob',1,$1,now(),$2)", digest[:], expiry)
	if err != nil {
		t.Fatal(err)
	}
	bob := auth.Principal{SessionID: "session-bob", AccountID: "bob", DeviceID: "device-bob", Generation: 1, ExpiresAt: expiry}
	_, err = pool.Exec(ctx, "INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES('alice','bob','friend','alice','accepted')")
	if err != nil {
		t.Fatal(err)
	}
	join := func() int64 {
		t.Helper()
		invite, err := circleService.Invite(ctx, actor, circle.ID, "bob")
		if err != nil {
			t.Fatal(err)
		}
		_, err = circleService.Respond(ctx, bob, invite.ID, true)
		if err != nil {
			t.Fatal(err)
		}
		details, err := circleService.Details(ctx, actor, circle.ID)
		if err != nil {
			t.Fatal(err)
		}
		return details.Epoch
	}
	epoch := join()
	if _, err := s.GetCircle(ctx, bob, circle.ID, "old-object"); !errors.Is(err, ErrDenied) {
		t.Fatalf("prejoin access: %v", err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "old-object", "media-operation", body); err != nil {
		t.Fatalf("exact retry after join: %v", err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "stale-new-object", "media-operation", body); !errors.Is(err, ErrDenied) {
		t.Fatalf("stale upload: %v", err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, epoch, "new-object", "media-operation", body); err != nil {
		t.Fatal(err)
	}
	if got, err := s.GetCircle(ctx, bob, circle.ID, "new-object"); err != nil || string(got) != string(body) {
		t.Fatalf("current grant: %q %v", got, err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, epoch, "new-object", "media-operation", []byte("replacement")); !errors.Is(err, ErrConflict) {
		t.Fatalf("replace: %v", err)
	}
	if err := circleService.Remove(ctx, actor, circle.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCircle(ctx, bob, circle.ID, "new-object"); !errors.Is(err, ErrDenied) {
		t.Fatalf("removed access: %v", err)
	}
	join()
	if _, err := s.GetCircle(ctx, bob, circle.ID, "new-object"); !errors.Is(err, ErrDenied) {
		t.Fatalf("rejoined access: %v", err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, "new-object"); err != nil {
		t.Fatal(err)
	}
	if err := circleService.Leave(ctx, bob, circle.ID); err != nil {
		t.Fatal(err)
	}
	if err := circleService.Leave(ctx, actor, circle.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, "new-object"); !errors.Is(err, ErrDenied) {
		t.Fatalf("closed access: %v", err)
	}
}

func TestRedactedMessageMediaIsNoLongerReadable(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	peerDigest := sha256.Sum256([]byte("bob"))
	if _, err := pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',$1,'BCDEFGHJ',1)`, peerDigest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES('alice','bob','friend-media','alice','accepted')`); err != nil {
		t.Fatal(err)
	}
	conversation := messages.PrivateConversationID("alice", "bob")
	privateID, privateOperation := "private-redacted", "private-media-redacted"
	if err := s.PutPrivate(ctx, actor, "bob", "friend:friend-media", privateID, privateOperation, []byte("private ciphertext")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetPrivate(ctx, actor, "bob", "friend:friend-media", privateID); err != nil {
		t.Fatalf("private media unavailable before redaction: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO message_events(id,sender_id,sender_generation,operation_id,conversation,audience,digest,envelope,redacted_at) VALUES('private-redacted-event','alice',1,$1,$2,'friend:friend-media',$3,'{}',now())`, privateOperation, conversation, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetPrivate(ctx, actor, "bob", "friend:friend-media", privateID); !errors.Is(err, ErrDenied) {
		t.Fatalf("redacted private media read=%v, want denied", err)
	}

	circle, err := circleService.Create(ctx, actor, "circle-redacted-media")
	if err != nil {
		t.Fatal(err)
	}
	circleID, circleOperation := "circle-redacted", "circle-media-redacted"
	if err := s.PutCircle(ctx, actor, circle.ID, 1, circleID, circleOperation, []byte("circle ciphertext")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, circleID); err != nil {
		t.Fatalf("Circle media unavailable before redaction: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO message_events(id,sender_id,sender_generation,operation_id,conversation,audience,circle_id,epoch,digest,envelope,redacted_at) VALUES('circle-redacted-event','alice',1,$1,$2,'circle:1',$2,1,$3,'{}',now())`, circleOperation, circle.ID, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, circleID); !errors.Is(err, ErrDenied) {
		t.Fatalf("redacted Circle media read=%v, want denied", err)
	}
}

func TestCircleMessageRedactionDeniesMediaToOriginalRecipients(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	bobDigest := sha256.Sum256([]byte("bob"))
	if _, err := pool.Exec(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',$1,'BCDEFGHJ',1)`, bobDigest[:]); err != nil {
		t.Fatal(err)
	}
	bobExpiry := time.Now().Add(time.Hour)
	bobTokenDigest := sha256.Sum256([]byte("bob-token"))
	if _, err := pool.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES('session-bob','bob','device-bob',1,$1,now(),$2)`, bobTokenDigest[:], bobExpiry); err != nil {
		t.Fatal(err)
	}
	identity := base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	signingIdentity := base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("c", 32)))
	if _, err := pool.Exec(ctx, `INSERT INTO key_identities(account_id,generation,device_id,identity,signing_identity) VALUES('bob',1,'device-bob',$1,$2)`, identity, signingIdentity); err != nil {
		t.Fatal(err)
	}
	bob := auth.Principal{SessionID: "session-bob", AccountID: "bob", DeviceID: "device-bob", Generation: 1, ExpiresAt: bobExpiry}
	if _, err := pool.Exec(ctx, `INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES('alice','bob','circle-redaction-friend','alice','accepted')`); err != nil {
		t.Fatal(err)
	}
	circle, err := circleService.Create(ctx, actor, "redacted-media-circle")
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := circleService.Invite(ctx, actor, circle.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := circleService.Respond(ctx, bob, invitation.ID, true); err != nil {
		t.Fatal(err)
	}
	messageService := messages.NewService(pool, s.auth)
	conversation, err := messageService.Context(ctx, actor, messages.ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	operation := "redacted-circle-photo"
	mediaID := "redacted-circle-photo-object"
	if err := s.PutCircle(ctx, actor, circle.ID, conversation.Epoch, mediaID, operation, []byte("opaque photo ciphertext")); err != nil {
		t.Fatal(err)
	}
	envelope := messages.Envelope{Version: 1, Operation: operation, Conversation: conversation.Conversation, Audience: conversation.Audience, Sender: conversation.Sender, ContentType: "text", Recipients: []messages.Recipient{}}
	for _, recipient := range conversation.Recipients {
		envelope.Recipients = append(envelope.Recipients, messages.Recipient{Peer: recipient.AccountID, Keys: recipient.Keys, Message: messages.Ciphertext{Kind: 0, Body: "c3ludGhldGlj"}})
	}
	rawEnvelope, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	event, err := messageService.Send(ctx, actor, string(rawEnvelope))
	if err != nil {
		t.Fatal(err)
	}
	for _, recipient := range []auth.Principal{actor, bob} {
		if _, err := s.GetCircle(ctx, recipient, circle.ID, mediaID); err != nil {
			t.Fatalf("original recipient %s could not read media before deletion: %v", recipient.AccountID, err)
		}
	}
	if _, err := messageService.Redact(ctx, actor, messages.RedactionTarget{EventID: event.ID}); err != nil {
		t.Fatal(err)
	}
	for _, recipient := range []auth.Principal{actor, bob} {
		if _, err := s.GetCircle(ctx, recipient, circle.ID, mediaID); !errors.Is(err, ErrDenied) {
			t.Errorf("original recipient %s media read after message deletion = %v, want denied", recipient.AccountID, err)
		}
	}
}

func TestCancelOperationFencesAndQueuesExactCircleMedia(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "cancel-media")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "cancelled-object", "cancel-media-op", []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	result, err := s.CancelOperation(ctx, actor, circle.ID, "cancel-media-op")
	if err != nil || result.State != "cancelled" {
		t.Fatalf("cancel result=%+v err=%v", result, err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, "cancelled-object"); !errors.Is(err, ErrDenied) {
		t.Fatalf("cancelled object remains readable: %v", err)
	}
	if _, err := s.storage.Get(ctx, "cancelled-object"); err != nil {
		t.Fatalf("queued ciphertext should remain until worker: %v", err)
	}
	var queued int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM circle_media_cleanup WHERE object_id='cancelled-object' AND state='pending'").Scan(&queued); err != nil || queued != 1 {
		t.Fatalf("cleanup rows=%d err=%v", queued, err)
	}
	retry, err := s.CancelOperation(ctx, actor, circle.ID, "cancel-media-op")
	if err != nil || retry.State != "cancelled" {
		t.Fatalf("cancel retry=%+v err=%v", retry, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM circle_media_cleanup WHERE object_id='cancelled-object'").Scan(&queued); err != nil || queued != 1 {
		t.Fatalf("duplicate cleanup rows=%d err=%v", queued, err)
	}
}

func TestCancelOperationPreservesMediaForCommittedEvent(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "committed-media")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "committed-object", "committed-media-op", []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO message_events(id,sender_id,sender_generation,operation_id,conversation,audience,circle_id,epoch,digest,envelope) VALUES('event-1',$1,$2,'committed-media-op',$3,'circle:1',$3,1,$4,'opaque')`, actor.AccountID, actor.Generation, circle.ID, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	result, err := s.CancelOperation(ctx, actor, circle.ID, "committed-media-op")
	if err != nil || result.State != "committed" || result.EventID != "event-1" {
		t.Fatalf("cancel committed result=%+v err=%v", result, err)
	}
	var tombstones, cleanup int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM message_operation_cancellations WHERE operation_id='committed-media-op'").Scan(&tombstones); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM circle_media_cleanup WHERE object_id='committed-object'").Scan(&cleanup); err != nil {
		t.Fatal(err)
	}
	if tombstones != 0 || cleanup != 0 {
		t.Fatalf("committed media fenced: tombstones=%d cleanup=%d", tombstones, cleanup)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, "committed-object"); err != nil {
		t.Fatalf("committed media denied: %v", err)
	}
}

func TestRelayCommitAndMediaCancellationUseOneOperationDecision(t *testing.T) {
	s, circleService, _, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "relay-media-race")
	if err != nil {
		t.Fatal(err)
	}
	current, err := messages.NewService(s.pool, s.auth).Context(ctx, actor, messages.ContextInput{CircleID: circle.ID})
	if err != nil {
		t.Fatal(err)
	}
	const operation = "relay-media-race-op"
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "relay-race-object", operation, []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	revision := int64(1)
	raw, err := json.Marshal(messages.Envelope{Version: 1, Operation: operation, Conversation: current.Conversation, Audience: current.Audience, Sender: current.Sender, Recipients: []messages.Recipient{}, ContentType: "circle-profile", ProfileRevision: &revision})
	if err != nil {
		t.Fatal(err)
	}
	sent, err := messages.NewService(s.pool, s.auth).Send(ctx, actor, string(raw))
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.CancelOperation(ctx, actor, circle.ID, operation)
	if err != nil || result.State != "committed" || result.EventID != sent.ID {
		t.Fatalf("commit then cancel result=%+v send=%+v err=%v", result, sent, err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, "relay-race-object"); err != nil {
		t.Fatalf("committed media denied: %v", err)
	}
}

func TestPrivateSendAndMediaCancellationShareOneOperationDecision(t *testing.T) {
	s, _, pool, actor := fixture(t)
	ctx := context.Background()
	digest := sha256.Sum256([]byte("bob"))
	if _, err := pool.Exec(ctx, "INSERT INTO auth_accounts(id,phone_digest,pin,generation) VALUES('bob',$1,'BCDEFGHJ',1)", digest[:]); err != nil {
		t.Fatal(err)
	}
	key := base64.RawStdEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	if _, err := pool.Exec(ctx, "INSERT INTO key_identities(account_id,generation,device_id,identity,signing_identity) VALUES('bob',1,'device-bob',$1,$1)", key); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO friend_links(low_id,high_id,request_id,requested_by,status) VALUES('alice','bob','friend-race','alice','accepted')"); err != nil {
		t.Fatal(err)
	}
	const operation = "private-race-op"
	if err := s.PutPrivate(ctx, actor, "bob", "friend:friend-race", "private-race-object", operation, []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	messagesService := messages.NewService(pool, s.auth)
	current, err := messagesService.Context(ctx, actor, messages.ContextInput{TargetID: "bob"})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := json.Marshal(messages.Envelope{Version: 1, Operation: operation, Conversation: current.Conversation, Audience: current.Audience, Sender: current.Sender, Recipients: []messages.Recipient{{Peer: "bob", Keys: current.Recipients[0].Keys, Message: messages.Ciphertext{Kind: 0, Body: "Y2lwaGVydGV4dA"}}}})
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	var sent messages.Event
	var sendErr error
	var cancelled OperationCancellation
	var cancelErr error
	go func() { defer wg.Done(); <-start; sent, sendErr = messagesService.Send(ctx, actor, string(envelope)) }()
	go func() {
		defer wg.Done()
		<-start
		cancelled, cancelErr = s.CancelPrivateOperation(ctx, actor, "bob", "friend:friend-race", operation)
	}()
	close(start)
	wg.Wait()
	if cancelErr != nil {
		t.Fatalf("cancel failed: %v", cancelErr)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM message_events WHERE operation_id=$1", operation).Scan(&count); err != nil {
		t.Fatal(err)
	}
	switch {
	case sendErr == nil:
		if count != 1 || cancelled.State != "committed" || cancelled.EventID != sent.ID {
			t.Fatalf("send=%+v/%v cancel=%+v events=%d", sent, sendErr, cancelled, count)
		}
		if _, err := s.GetPrivate(ctx, actor, "bob", "friend:friend-race", "private-race-object"); err != nil {
			t.Fatalf("committed photo not readable: %v", err)
		}
	case errors.Is(sendErr, messages.ErrCancelled):
		if count != 0 || cancelled.State != "cancelled" {
			t.Fatalf("cancel won with events=%d result=%+v", count, cancelled)
		}
		if _, err := s.GetPrivate(ctx, actor, "bob", "friend:friend-race", "private-race-object"); !errors.Is(err, ErrDenied) {
			t.Fatalf("cancelled photo remained readable: %v", err)
		}
	default:
		t.Fatalf("unexpected send race result: %v", sendErr)
	}
}

func mediaToken() string {
	return base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
}
func mediaTokenDigest() []byte { digest := sha256.Sum256([]byte(mediaToken())); return digest[:] }

type lostWriteStorage struct {
	Storage
	lost bool
}

func (s *lostWriteStorage) Put(ctx context.Context, id string, body []byte) error {
	if err := s.Storage.Put(ctx, id, body); err != nil {
		return err
	}
	if !s.lost {
		s.lost = true
		return io.ErrUnexpectedEOF
	}
	return nil
}

func TestCircleMediaFailedStorageDoesNotCommitGrants(t *testing.T) {
	s, circleService, pool, actor := fixture(t)
	ctx := context.Background()
	circle, err := circleService.Create(ctx, actor, "storage-loss")
	if err != nil {
		t.Fatal(err)
	}
	s.storage = &lostWriteStorage{Storage: s.storage}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "uncertain", "uncertain-op", []byte("opaque")); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("lost write: %v", err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM circle_media_objects").Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed upload claim: %d %v", count, err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, "uncertain"); !errors.Is(err, ErrDenied) {
		t.Fatalf("orphan download: %v", err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "uncertain", "uncertain-op", []byte("opaque")); err != nil {
		t.Fatalf("exact recovery: %v", err)
	}
	if _, err := pool.Exec(ctx, "UPDATE auth_accounts SET generation=2 WHERE id=$1", actor.AccountID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetCircle(ctx, actor, circle.ID, "uncertain"); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked download: %v", err)
	}
	if err := s.PutCircle(ctx, actor, circle.ID, 1, "uncertain", "uncertain-op", []byte("opaque")); !errors.Is(err, auth.ErrSessionRevoked) {
		t.Fatalf("revoked retry: %v", err)
	}
}
