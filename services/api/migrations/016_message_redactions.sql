ALTER TABLE message_events ADD COLUMN redacted_at timestamptz;

CREATE TABLE message_redactions (
 event_id text PRIMARY KEY REFERENCES message_events(id),
 sender_id text NOT NULL REFERENCES auth_accounts(id),
 conversation text NOT NULL,
 audience text NOT NULL,
 operation_id text NOT NULL,
 sender_keys jsonb NOT NULL,
 committed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_redaction_cursors (
 account_id text PRIMARY KEY REFERENCES auth_accounts(id),
 sequence bigint NOT NULL DEFAULT 0 CHECK(sequence >= 0)
);

CREATE TABLE message_redaction_feed (
 account_id text NOT NULL REFERENCES auth_accounts(id),
 sequence bigint NOT NULL CHECK(sequence > 0),
 event_id text NOT NULL REFERENCES message_redactions(event_id),
 PRIMARY KEY(account_id, sequence),
 UNIQUE(account_id, event_id)
);

CREATE INDEX message_redaction_feed_event ON message_redaction_feed(event_id);
