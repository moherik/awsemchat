package media

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"awsemchat/services/api/internal/auth"
)

const cleanupLease = time.Minute

// DrainCleanup claims and processes at most batchSize durable object deletions.
func (s *Service) DrainCleanup(ctx context.Context, batchSize int) (int, error) {
	if batchSize < 1 || batchSize > 128 {
		return 0, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, auth.ErrUnavailable
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `WITH candidates AS (
		SELECT 'circle' AS kind,object_id,created_at FROM (
			SELECT object_id,created_at FROM circle_media_cleanup WHERE state='pending' OR (state='processing' AND lease_until<now()) ORDER BY created_at,object_id FOR UPDATE SKIP LOCKED LIMIT $1
		) circle_jobs
		UNION ALL
		SELECT 'private' AS kind,object_id,created_at FROM (
			SELECT object_id,created_at FROM private_media_cleanup WHERE state='pending' OR (state='processing' AND lease_until<now()) ORDER BY created_at,object_id FOR UPDATE SKIP LOCKED LIMIT $1
		) private_jobs
	)
	SELECT kind,object_id FROM candidates ORDER BY created_at,kind,object_id LIMIT $1`, batchSize)
	if err != nil {
		return 0, auth.ErrUnavailable
	}
	type cleanupItem struct{ kind, id string }
	items := make([]cleanupItem, 0, batchSize)
	for rows.Next() {
		var item cleanupItem
		if err := rows.Scan(&item.kind, &item.id); err != nil {
			rows.Close()
			return 0, auth.ErrUnavailable
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, auth.ErrUnavailable
	}
	for _, item := range items {
		table := cleanupTable(item.kind)
		if _, err := tx.Exec(ctx, `UPDATE `+table+` SET state='processing',lease_until=now()+make_interval(secs => $2) WHERE object_id=$1`, item.id, cleanupLease.Seconds()); err != nil {
			return 0, auth.ErrUnavailable
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, auth.ErrUnavailable
	}
	completed := 0
	var failures []error
	for _, item := range items {
		table := cleanupTable(item.kind)
		if err := s.storage.Delete(ctx, item.id); err != nil {
			if _, updateErr := s.pool.Exec(ctx, `UPDATE `+table+` SET state='pending',lease_until=NULL WHERE object_id=$1 AND state='processing'`, item.id); updateErr != nil {
				failures = append(failures, auth.ErrUnavailable)
			}
			failures = append(failures, err)
			continue
		}
		result, err := s.pool.Exec(ctx, `UPDATE `+table+` SET state='complete',lease_until=NULL,completed_at=now() WHERE object_id=$1 AND state='processing'`, item.id)
		if err != nil {
			failures = append(failures, auth.ErrUnavailable)
			continue
		}
		if result.RowsAffected() == 1 {
			completed++
		}
	}
	return completed, errors.Join(failures...)
}

// RunCleanup drains immediately, then polls durable work with bounded backoff.
func (s *Service) RunCleanup(ctx context.Context) {
	backoff := time.Second
	for {
		count, err := s.DrainCleanup(ctx, 32)
		orphanCount, orphanErr := s.cleanupStorageOrphans(ctx)
		count += orphanCount
		if orphanErr != nil {
			err = errors.Join(err, orphanErr)
		}
		if ctx.Err() != nil {
			return
		}
		wait := 5 * time.Second
		if err != nil {
			slog.Error("encrypted media cleanup batch failed")
			wait = backoff
			backoff *= 2
			if backoff > time.Minute {
				backoff = time.Minute
			}
		} else {
			backoff = time.Second
			if count > 0 {
				continue
			}
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Service) cleanupStorageOrphans(ctx context.Context) (int, error) {
	cleaner, ok := s.storage.(interface {
		CleanupOrphans(context.Context) (int, error)
	})
	if !ok {
		return 0, nil
	}
	return cleaner.CleanupOrphans(ctx)
}

func cleanupTable(kind string) string {
	if kind == "private" {
		return "private_media_cleanup"
	}
	return "circle_media_cleanup"
}
