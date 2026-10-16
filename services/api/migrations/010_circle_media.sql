CREATE TABLE circle_media_objects (
 id text PRIMARY KEY,
 circle_id text NOT NULL REFERENCES circles(id),
 owner_id text NOT NULL REFERENCES auth_accounts(id),
 epoch bigint NOT NULL CHECK(epoch BETWEEN 1 AND 9007199254740991),
 ciphertext_digest bytea NOT NULL CHECK(octet_length(ciphertext_digest)=32),
 ciphertext_size integer NOT NULL CHECK(ciphertext_size BETWEEN 1 AND 8388608),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,circle_id)
);
CREATE TABLE circle_media_grants (
 object_id text NOT NULL,
 circle_id text NOT NULL,
 interval_id text NOT NULL,
 account_id text NOT NULL,
 PRIMARY KEY(object_id,interval_id),
 FOREIGN KEY(object_id,circle_id) REFERENCES circle_media_objects(id,circle_id),
 FOREIGN KEY(interval_id,circle_id,account_id) REFERENCES circle_memberships(id,circle_id,account_id)
);
