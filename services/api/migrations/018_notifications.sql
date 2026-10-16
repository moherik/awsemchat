CREATE TABLE notification_devices (
 account_id text PRIMARY KEY REFERENCES auth_accounts(id) ON DELETE CASCADE,
 generation bigint NOT NULL CHECK(generation > 0),
 expo_token text NOT NULL UNIQUE CHECK(length(expo_token) <= 256 AND left(expo_token,14) = 'ExpoPushToken[' AND right(expo_token,1) = ']'),
 muted_conversations text[] NOT NULL DEFAULT '{}'::text[],
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_outbox (
 event_id text NOT NULL REFERENCES message_events(id) ON DELETE CASCADE,
 account_id text NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
 generation bigint NOT NULL CHECK(generation > 0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,account_id,generation)
);
CREATE INDEX notification_outbox_available ON notification_outbox(available_at,created_at);
