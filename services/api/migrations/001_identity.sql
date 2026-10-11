CREATE TABLE auth_challenges (
  id text PRIMARY KEY,
  operation_id text NOT NULL,
  device_id text NOT NULL,
  phone_digest bytea NOT NULL CHECK (octet_length(phone_digest) = 32),
  network_digest bytea NOT NULL CHECK (octet_length(network_digest) = 32),
  code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'consumed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (phone_digest, operation_id)
);
CREATE INDEX auth_challenges_phone_created ON auth_challenges (phone_digest, created_at);
CREATE INDEX auth_challenges_network_created ON auth_challenges (network_digest, created_at);
CREATE TABLE auth_accounts (
 id text PRIMARY KEY,
 phone_digest bytea NOT NULL UNIQUE CHECK(octet_length(phone_digest)=32),
 pin text NOT NULL UNIQUE CHECK(pin ~ '^[A-HJ-NP-Z2-9]{8}$'),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0 AND generation<=9007199254740991)
);
CREATE TABLE auth_sessions (
 id text PRIMARY KEY,
 account_id text NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
 device_id text NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE UNIQUE INDEX auth_sessions_one_active_phone ON auth_sessions(account_id) WHERE revoked_at IS NULL;
