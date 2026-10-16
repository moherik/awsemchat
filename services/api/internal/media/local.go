package media

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	ErrInvalid  = errors.New("invalid media object")
	ErrConflict = errors.New("media object already contains different ciphertext")
	ErrNotFound = errors.New("media object not found")
	objectID    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`)
)

const maxCiphertext = 8 * 1024 * 1024

const stalePendingAge = 24 * time.Hour

// LocalStore stores opaque ciphertext in a private, service-owned directory.
// Callers must authorize access before invoking it.
type LocalStore struct{ root string }

func NewLocalStore(root string) (*LocalStore, error) {
	path, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, ErrInvalid
	}
	return &LocalStore{root: path}, nil
}

func (s *LocalStore) Put(ctx context.Context, id string, ciphertext []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !objectID.MatchString(id) || len(ciphertext) == 0 || len(ciphertext) > maxCiphertext {
		return ErrInvalid
	}
	file, err := os.CreateTemp(s.root, ".pending-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err := file.Write(ciphertext); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Link(file.Name(), filepath.Join(s.root, id)); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return err
		}
		stored, err := s.Get(ctx, id)
		if err != nil {
			return err
		}
		if !bytes.Equal(stored, ciphertext) {
			return ErrConflict
		}
	}
	directory, err := os.Open(s.root)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (s *LocalStore) Get(ctx context.Context, id string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !objectID.MatchString(id) {
		return nil, ErrInvalid
	}
	path := filepath.Join(s.root, id)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxCiphertext {
		return nil, ErrInvalid
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxCiphertext+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > maxCiphertext {
		return nil, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return data, nil
}

// Delete removes one immutable ciphertext object. Deleting a missing object is
// successful so durable cleanup retries can safely resume after a lost reply.
func (s *LocalStore) Delete(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !objectID.MatchString(id) {
		return ErrInvalid
	}
	err := os.Remove(filepath.Join(s.root, id))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	directory, err := os.Open(s.root)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

// CleanupOrphans removes old temporary writes left by a process that stopped
// before its deferred file removal ran. Recent writes remain untouched.
func (s *LocalStore) CleanupOrphans(ctx context.Context) (int, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return 0, err
	}
	cutoff := time.Now().Add(-stalePendingAge)
	removed := 0
	returnAfterSync := func(err error) (int, error) {
		if removed > 0 {
			return removed, errors.Join(err, s.syncRoot())
		}
		return removed, err
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return returnAfterSync(err)
		}
		if !strings.HasPrefix(entry.Name(), ".pending-") {
			continue
		}
		info, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return returnAfterSync(err)
		}
		if !info.Mode().IsRegular() || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(s.root, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return returnAfterSync(err)
		} else if err == nil {
			removed++
		}
	}
	if removed == 0 {
		return 0, nil
	}
	if err := s.syncRoot(); err != nil {
		return removed, err
	}
	return removed, nil
}

func (s *LocalStore) syncRoot() error {
	directory, err := os.Open(s.root)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
