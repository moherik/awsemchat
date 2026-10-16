// Package operations provides the shared PostgreSQL lock used to arbitrate
// relay sends, media uploads, and cancellation for one account operation.
package operations

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"strconv"

	"github.com/jackc/pgx/v5"
)

func advisoryKey(accountID string, generation int64, operationID string) int64 {
	value := "awsemchat.message-operation\x00" + accountID + "\x00" + strconv.FormatInt(generation, 10) + "\x00" + operationID
	digest := sha256.Sum256([]byte(value))
	return int64(binary.BigEndian.Uint64(digest[:8]))
}

// Lock orders work for a single account generation and immutable operation ID.
func Lock(ctx context.Context, tx pgx.Tx, accountID string, generation int64, operationID string) error {
	_, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", advisoryKey(accountID, generation, operationID))
	return err
}
