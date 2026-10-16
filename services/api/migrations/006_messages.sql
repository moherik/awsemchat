CREATE TABLE message_events (
 id text PRIMARY KEY,
 sender_id text NOT NULL REFERENCES auth_accounts(id),
 sender_generation bigint NOT NULL,
 operation_id text NOT NULL,
 conversation text NOT NULL,
 audience text NOT NULL,
 circle_id text NOT NULL DEFAULT '',
 epoch bigint NOT NULL DEFAULT 0,
 digest bytea NOT NULL CHECK(octet_length(digest)=32),
 envelope text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sender_id,sender_generation,operation_id)
);
CREATE TABLE message_deliveries (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id text NOT NULL REFERENCES message_events(id),
 recipient_id text NOT NULL REFERENCES auth_accounts(id),
 recipient_generation bigint NOT NULL,
 membership_interval text NOT NULL DEFAULT '',
 public_keys jsonb NOT NULL,
 ciphertext jsonb NOT NULL,
 delivered_at timestamptz,
 UNIQUE(event_id,recipient_id)
);
CREATE INDEX message_deliveries_recipient_sequence ON message_deliveries(recipient_id,recipient_generation,sequence);
