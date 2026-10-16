CREATE TABLE user_reports (
 id text PRIMARY KEY,
 operation_id text NOT NULL,
 reporter_id text NOT NULL REFERENCES auth_accounts(id),
 subject_id text NOT NULL REFERENCES auth_accounts(id),
 conversation text NOT NULL,
 reason text NOT NULL CHECK(reason IN ('spam','harassment','scam','something-else')),
 details text NOT NULL CHECK(length(details) <= 1000),
 selected_content jsonb NOT NULL CHECK(jsonb_typeof(selected_content) = 'array'),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest) = 32),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at = created_at + interval '90 days'),
 UNIQUE(reporter_id, operation_id),
 CHECK(reporter_id <> subject_id),
 CHECK(conversation LIKE 'private:%')
);
CREATE INDEX user_reports_expiry ON user_reports(expires_at);
