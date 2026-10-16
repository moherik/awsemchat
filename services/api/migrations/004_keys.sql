CREATE TABLE key_identities (
 account_id text NOT NULL REFERENCES auth_accounts(id),
 generation bigint NOT NULL CHECK(generation>0),
 device_id text NOT NULL,
 identity text NOT NULL,
 signing_identity text NOT NULL,
 PRIMARY KEY(account_id,generation)
);
CREATE TABLE key_publications (
 account_id text NOT NULL,
 generation bigint NOT NULL,
 operation_id text NOT NULL,
 digest bytea NOT NULL CHECK(octet_length(digest)=32),
 PRIMARY KEY(account_id,generation,operation_id),
 FOREIGN KEY(account_id,generation) REFERENCES key_identities(account_id,generation)
);
CREATE TABLE key_prekeys (
 account_id text NOT NULL,
 generation bigint NOT NULL,
 operation_id text NOT NULL,
 key_id text NOT NULL,
 prekey text NOT NULL,
 bundle jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,generation,key_id),
 UNIQUE(account_id,generation,prekey),
 FOREIGN KEY(account_id,generation,operation_id) REFERENCES key_publications(account_id,generation,operation_id)
);
