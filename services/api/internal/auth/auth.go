package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"math/big"
	"net/netip"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("authentication unavailable")
var ErrInvalidInput = errors.New("invalid authentication input")
var ErrRateLimited = errors.New("verification rate limited")
var ErrChallengePending = errors.New("verification delivery pending")
var ErrInvalidCode = errors.New("invalid verification code")
var ErrExpired = errors.New("verification expired")
var ErrConsumed = errors.New("verification already consumed")
var ErrSessionRevoked = errors.New("session revoked or expired")
var phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
var idPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
var codePattern = regexp.MustCompile(`^[0-9]{6}$`)

type SMS interface {
	SendCode(context.Context, string, string) error
}
type Config struct {
	Pepper []byte
	Now    func() time.Time
}
type StartInput struct{ Phone, DeviceID, OperationID, Network string }
type Challenge struct {
	ID        string    `json:"challengeId"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type VerifyInput struct{ ChallengeID, Code, DeviceID string }
type PublicAccount struct {
	ID  string `json:"id"`
	PIN string `json:"pin"`
}
type Session struct {
	Token      string        `json:"accessToken"`
	Account    PublicAccount `json:"account"`
	DeviceID   string        `json:"deviceId"`
	Generation int64         `json:"generation"`
	ExpiresAt  time.Time     `json:"expiresAt"`
}
type Principal struct {
	SessionID, AccountID, DeviceID string
	Generation                     int64
	ExpiresAt                      time.Time
}
type Service struct {
	pool   *pgxpool.Pool
	sms    SMS
	pepper []byte
	now    func() time.Time
}

func NewService(pool *pgxpool.Pool, sms SMS, cfg Config) (*Service, error) {
	if pool == nil || sms == nil || len(cfg.Pepper) != 32 {
		return nil, ErrUnavailable
	}
	nonzero := false
	for _, b := range cfg.Pepper {
		nonzero = nonzero || b != 0
	}
	if !nonzero {
		return nil, ErrUnavailable
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Service{pool: pool, sms: sms, pepper: append([]byte(nil), cfg.Pepper...), now: cfg.Now}, nil
}
func (s *Service) digest(domain, value string) []byte {
	mac := hmac.New(sha256.New, s.pepper)
	mac.Write([]byte(domain + "\x00" + value))
	return mac.Sum(nil)
}

func (s *Service) Start(ctx context.Context, input StartInput) (Challenge, error) {
	network, err := netip.ParseAddr(input.Network)
	if err != nil || !phonePattern.MatchString(input.Phone) || !idPattern.MatchString(input.DeviceID) || !idPattern.MatchString(input.OperationID) {
		return Challenge{}, ErrInvalidInput
	}
	input.Network = network.Unmap().String()
	result, code, err := s.reserve(ctx, input)
	if err != nil || code == "" {
		return result, err
	}
	if err = s.sms.SendCode(ctx, input.Phone, code); err != nil {
		if _, updateErr := s.pool.Exec(ctx, `UPDATE auth_challenges SET status='failed' WHERE id=$1 AND status='pending'`, result.ID); updateErr != nil {
			return Challenge{}, ErrUnavailable
		}
		return Challenge{}, ErrUnavailable
	}
	if _, err = s.pool.Exec(ctx, `UPDATE auth_challenges SET status='ready' WHERE id=$1 AND status='pending'`, result.ID); err != nil {
		return Challenge{}, ErrUnavailable
	}
	return result, nil
}

func (s *Service) reserve(ctx context.Context, input StartInput) (Challenge, string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Challenge{}, "", ErrUnavailable
	}
	defer tx.Rollback(ctx)
	phone := s.digest("phone", input.Phone)
	network := s.digest("network", input.Network)
	for i, key := range [][]byte{network, phone} {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1,$2)`, int32(i+1), int32(binary.BigEndian.Uint32(key[:4]))); err != nil {
			return Challenge{}, "", ErrUnavailable
		}
	}
	var result Challenge
	var status, device string
	err = tx.QueryRow(ctx, `SELECT id,expires_at,status,device_id FROM auth_challenges WHERE phone_digest=$1 AND operation_id=$2`, phone, input.OperationID).Scan(&result.ID, &result.ExpiresAt, &status, &device)
	if err == nil {
		if device != input.DeviceID {
			return Challenge{}, "", ErrInvalidInput
		}
		if status == "pending" {
			return result, "", ErrChallengePending
		}
		if status != "ready" || !result.ExpiresAt.After(s.now()) {
			return Challenge{}, "", ErrUnavailable
		}
		return result, "", nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Challenge{}, "", ErrUnavailable
	}
	now := s.now()
	var recent bool
	var count int
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM auth_challenges WHERE phone_digest=$1 AND created_at>$2)`, phone, now.Add(-time.Minute)).Scan(&recent); err != nil {
		return Challenge{}, "", ErrUnavailable
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM auth_challenges WHERE network_digest=$1 AND created_at>$2`, network, now.Add(-time.Hour)).Scan(&count); err != nil {
		return Challenge{}, "", ErrUnavailable
	}
	if recent || count >= 10 {
		return Challenge{}, "", ErrRateLimited
	}
	number, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return Challenge{}, "", ErrUnavailable
	}
	code := fmt.Sprintf("%06d", number.Int64())
	result = Challenge{ID: rand.Text(), ExpiresAt: now.Add(5 * time.Minute)}
	if _, err := tx.Exec(ctx, `INSERT INTO auth_challenges(id,operation_id,device_id,phone_digest,network_digest,code_digest,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)`, result.ID, input.OperationID, input.DeviceID, phone, network, s.digest("code", result.ID+"\x00"+code), now, result.ExpiresAt); err != nil {
		return Challenge{}, "", ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return Challenge{}, "", ErrUnavailable
	}
	return result, code, nil
}
func (s *Service) Verify(ctx context.Context, input VerifyInput) (Session, error) {
	if !idPattern.MatchString(input.ChallengeID) || !idPattern.MatchString(input.DeviceID) || !codePattern.MatchString(input.Code) {
		return Session{}, ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	var phone, expected []byte
	var device, status string
	var expiry time.Time
	var attempts int
	err = tx.QueryRow(ctx, `SELECT phone_digest,code_digest,device_id,status,expires_at,attempts FROM auth_challenges WHERE id=$1 FOR UPDATE`, input.ChallengeID).Scan(&phone, &expected, &device, &status, &expiry, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCode
	}
	if err != nil {
		return Session{}, ErrUnavailable
	}
	if device != input.DeviceID {
		return Session{}, ErrInvalidCode
	}
	if status == "consumed" {
		return Session{}, ErrConsumed
	}
	if status != "ready" {
		return Session{}, ErrInvalidCode
	}
	now := s.now()
	if !expiry.After(now) {
		return Session{}, ErrExpired
	}
	if attempts >= 5 {
		return Session{}, ErrInvalidCode
	}
	if !hmac.Equal(expected, s.digest("code", input.ChallengeID+"\x00"+input.Code)) {
		if _, err := tx.Exec(ctx, `UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1`, input.ChallengeID); err != nil {
			return Session{}, ErrUnavailable
		}
		if err := tx.Commit(ctx); err != nil {
			return Session{}, ErrUnavailable
		}
		return Session{}, ErrInvalidCode
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(2,$1)`, int32(binary.BigEndian.Uint32(phone[:4]))); err != nil {
		return Session{}, ErrUnavailable
	}
	account, err := findOrCreateAccount(ctx, tx, phone)
	if err != nil {
		return Session{}, ErrUnavailable
	}
	var generation int64
	if err := tx.QueryRow(ctx, `UPDATE auth_accounts SET generation=generation+1 WHERE id=$1 RETURNING generation`, account.ID).Scan(&generation); err != nil {
		return Session{}, ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_sessions SET revoked_at=$1 WHERE account_id=$2 AND revoked_at IS NULL`, now, account.ID); err != nil {
		return Session{}, ErrUnavailable
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return Session{}, ErrUnavailable
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	tokenDigest := sha256.Sum256([]byte(token))
	expires := now.Add(30 * 24 * time.Hour)
	if _, err := tx.Exec(ctx, `INSERT INTO auth_sessions(id,account_id,device_id,generation,token_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, rand.Text(), account.ID, device, generation, tokenDigest[:], now, expires); err != nil {
		return Session{}, ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_challenges SET status='consumed' WHERE id=$1`, input.ChallengeID); err != nil {
		return Session{}, ErrUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, ErrUnavailable
	}
	return Session{Token: token, Account: account, DeviceID: device, Generation: generation, ExpiresAt: expires}, nil
}

func findOrCreateAccount(ctx context.Context, tx pgx.Tx, phone []byte) (PublicAccount, error) {
	for i := 0; i < 5; i++ {
		var account PublicAccount
		err := tx.QueryRow(ctx, `SELECT id,pin FROM auth_accounts WHERE phone_digest=$1 FOR UPDATE`, phone).Scan(&account.ID, &account.PIN)
		if err == nil {
			return account, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return PublicAccount{}, err
		}
		const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
		pin := make([]byte, 8)
		for j := range pin {
			number, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
			if err != nil {
				return PublicAccount{}, err
			}
			pin[j] = alphabet[number.Int64()]
		}
		err = tx.QueryRow(ctx, `INSERT INTO auth_accounts(id,phone_digest,pin) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id,pin`, rand.Text(), phone, string(pin)).Scan(&account.ID, &account.PIN)
		if err == nil {
			return account, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return PublicAccount{}, err
		}
	}
	return PublicAccount{}, ErrUnavailable
}

func (s *Service) RequireSession(ctx context.Context, token string) (Principal, error) {
	if len(token) != 43 {
		return Principal{}, ErrSessionRevoked
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != 32 || base64.RawURLEncoding.EncodeToString(decoded) != token {
		return Principal{}, ErrSessionRevoked
	}
	digest := sha256.Sum256([]byte(token))
	var result Principal
	err = s.pool.QueryRow(ctx, `SELECT s.id,s.account_id,s.device_id,s.generation,s.expires_at FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.generation=a.generation AND s.expires_at>$2`, digest[:], s.now()).Scan(&result.SessionID, &result.AccountID, &result.DeviceID, &result.Generation, &result.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrSessionRevoked
	}
	if err != nil {
		return Principal{}, ErrUnavailable
	}
	return result, nil
}

func (s *Service) SignOut(ctx context.Context, token string) error {
	if len(token) != 43 {
		return ErrSessionRevoked
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != 32 || base64.RawURLEncoding.EncodeToString(decoded) != token {
		return ErrSessionRevoked
	}
	digest := sha256.Sum256([]byte(token))
	if _, err := s.pool.Exec(ctx, `UPDATE auth_sessions SET revoked_at=$1 WHERE token_digest=$2 AND revoked_at IS NULL`, s.now(), digest[:]); err != nil {
		return ErrUnavailable
	}
	return nil
}
