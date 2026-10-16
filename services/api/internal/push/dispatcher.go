package push

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const maxAttempts = 8

type Sender interface {
	Send(context.Context, string) error
}

type Dispatcher struct {
	pool   *pgxpool.Pool
	sender Sender
}

func NewDispatcher(pool *pgxpool.Pool, sender Sender) *Dispatcher {
	return &Dispatcher{pool: pool, sender: sender}
}

type queuedNotification struct {
	eventID, accountID, token string
	generation                int64
	attempts                  int
}

func (d *Dispatcher) Dispatch(ctx context.Context) error {
	if d.pool == nil || d.sender == nil {
		return ErrUnavailable
	}
	batch, err := d.claim(ctx)
	if err != nil {
		return err
	}
	for _, item := range batch {
		if err = d.sender.Send(ctx, item.token); err == nil {
			_, err = d.pool.Exec(ctx, `DELETE FROM notification_outbox WHERE event_id=$1 AND account_id=$2 AND generation=$3`, item.eventID, item.accountID, item.generation)
			if err != nil {
				return err
			}
			continue
		}
		if errors.Is(err, ErrDeviceNotRegistered) {
			if _, deleteErr := d.pool.Exec(ctx, `DELETE FROM notification_devices WHERE account_id=$1 AND generation=$2 AND expo_token=$3`, item.accountID, item.generation, item.token); deleteErr != nil {
				return deleteErr
			}
			if _, deleteErr := d.pool.Exec(ctx, `DELETE FROM notification_outbox WHERE account_id=$1 AND generation=$2`, item.accountID, item.generation); deleteErr != nil {
				return deleteErr
			}
			continue
		}
		if item.attempts >= maxAttempts {
			if _, err = d.pool.Exec(ctx, `DELETE FROM notification_outbox WHERE event_id=$1 AND account_id=$2 AND generation=$3`, item.eventID, item.accountID, item.generation); err != nil {
				return err
			}
			continue
		}
		due := time.Now().Add(retryDelay(item.attempts))
		if _, err = d.pool.Exec(ctx, `UPDATE notification_outbox SET available_at=$4 WHERE event_id=$1 AND account_id=$2 AND generation=$3`, item.eventID, item.accountID, item.generation, due); err != nil {
			return err
		}
	}
	return nil
}

func (d *Dispatcher) claim(ctx context.Context) ([]queuedNotification, error) {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `WITH ready AS (
		SELECT o.event_id,o.account_id,o.generation,d.expo_token
		FROM notification_outbox o JOIN notification_devices d ON d.account_id=o.account_id AND d.generation=o.generation
		WHERE o.available_at<=now()
		ORDER BY o.available_at,o.created_at
		FOR UPDATE OF o SKIP LOCKED LIMIT 25
	) UPDATE notification_outbox o
	SET attempts=o.attempts+1,available_at=now()+interval '2 minutes'
	FROM ready r
	WHERE o.event_id=r.event_id AND o.account_id=r.account_id AND o.generation=r.generation
	RETURNING o.event_id,o.account_id,o.generation,r.expo_token,o.attempts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]queuedNotification, 0, 25)
	for rows.Next() {
		var item queuedNotification
		if err = rows.Scan(&item.eventID, &item.accountID, &item.generation, &item.token, &item.attempts); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return items, nil
}

func (d *Dispatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		_ = d.Dispatch(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
