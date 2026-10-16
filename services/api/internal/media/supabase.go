package media

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var storageBucketID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)

// SupabaseStore sends opaque media ciphertext to a private Supabase Storage
// bucket. Its service key is used only by this server-side adapter.
type SupabaseStore struct {
	baseURL string
	bucket  string
	key     string
	client  *http.Client
}

func NewSupabaseStore(projectURL, serviceKey, bucket string) (*SupabaseStore, error) {
	parsed, err := url.Parse(projectURL)
	if err != nil || !validStorageOrigin(parsed) || strings.TrimSpace(serviceKey) == "" || len(serviceKey) > 4096 || strings.ContainsAny(serviceKey, "\r\n") || !storageBucketID.MatchString(bucket) {
		return nil, ErrInvalid
	}
	return &SupabaseStore{
		baseURL: strings.TrimRight(projectURL, "/") + "/storage/v1",
		bucket:  bucket,
		key:     serviceKey,
		client: &http.Client{
			Timeout: 15 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func validStorageOrigin(value *url.URL) bool {
	if value == nil || value.Host == "" || value.User != nil || value.RawQuery != "" || value.Fragment != "" || (value.Path != "" && value.Path != "/") {
		return false
	}
	if value.Scheme == "https" {
		return true
	}
	if value.Scheme != "http" {
		return false
	}
	host := value.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *SupabaseStore) objectURL(id string) string {
	return s.baseURL + "/object/" + url.PathEscape(s.bucket) + "/" + url.PathEscape(id)
}

func (s *SupabaseStore) bucketURL() string {
	return s.baseURL + "/object/" + url.PathEscape(s.bucket)
}

func (s *SupabaseStore) request(ctx context.Context, method, target string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, ErrInvalid
	}
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
	if method == http.MethodDelete {
		req.Header.Set("Content-Type", "application/json")
	}
	return s.client.Do(req)
}

func (s *SupabaseStore) Put(ctx context.Context, id string, ciphertext []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !objectID.MatchString(id) || len(ciphertext) == 0 || len(ciphertext) > maxCiphertext {
		return ErrInvalid
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.objectURL(id), bytes.NewReader(ciphertext))
	if err != nil {
		return ErrInvalid
	}
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Cache-Control", "max-age=0")
	req.Header.Set("x-upsert", "false")
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 4097))
	if readErr != nil {
		return readErr
	}
	if len(responseBody) > 4096 {
		return fmt.Errorf("Supabase Storage returned status %d", response.StatusCode)
	}
	if isDuplicateObject(response.StatusCode, responseBody) {
		stored, getErr := s.Get(ctx, id)
		if getErr != nil {
			return getErr
		}
		if !bytes.Equal(stored, ciphertext) {
			return ErrConflict
		}
		return nil
	}
	return fmt.Errorf("Supabase Storage returned status %d", response.StatusCode)
}

func isDuplicateObject(status int, body []byte) bool {
	if status != http.StatusBadRequest && status != http.StatusConflict {
		return false
	}
	var value struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &value) != nil {
		return false
	}
	return strings.EqualFold(value.Error, "Duplicate") || strings.Contains(strings.ToLower(value.Message), "already exists")
}

func (s *SupabaseStore) Get(ctx context.Context, id string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !objectID.MatchString(id) {
		return nil, ErrInvalid
	}
	response, err := s.request(ctx, http.MethodGet, s.objectURL(id), nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("Supabase Storage returned status %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxCiphertext+1))
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

func (s *SupabaseStore) Delete(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !objectID.MatchString(id) {
		return ErrInvalid
	}
	body, err := json.Marshal(struct {
		Prefixes []string `json:"prefixes"`
	}{Prefixes: []string{id}})
	if err != nil {
		return err
	}
	response, err := s.request(ctx, http.MethodDelete, s.bucketURL(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	return fmt.Errorf("Supabase Storage returned status %d", response.StatusCode)
}

var _ Storage = (*SupabaseStore)(nil)
