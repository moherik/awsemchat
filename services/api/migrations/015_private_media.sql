CREATE TABLE private_media_objects (
 id text PRIMARY KEY,
 conversation text NOT NULL,
 audience text NOT NULL,
 owner_id text NOT NULL REFERENCES auth_accounts(id),
 peer_id text NOT NULL REFERENCES auth_accounts(id),
 owner_generation bigint NOT NULL CHECK(owner_generation>0),
 operation_id text NOT NULL,
 ciphertext_digest bytea NOT NULL CHECK(octet_length(ciphertext_digest)=32),
 ciphertext_size integer NOT NULL CHECK(ciphertext_size BETWEEN 1 AND 8388608),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(owner_id<>peer_id),
 UNIQUE(owner_id,owner_generation,operation_id)
);
CREATE INDEX private_media_peer ON private_media_objects(peer_id,conversation,audience);

CREATE TABLE private_media_cleanup (
 object_id text PRIMARY KEY REFERENCES private_media_objects(id),
 owner_id text NOT NULL REFERENCES auth_accounts(id),
 owner_generation bigint NOT NULL CHECK(owner_generation>0),
 operation_id text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','complete')),
 created_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 completed_at timestamptz,
 CHECK((state='pending' AND lease_until IS NULL AND completed_at IS NULL) OR (state='processing' AND lease_until IS NOT NULL AND completed_at IS NULL) OR (state='complete' AND lease_until IS NULL AND completed_at IS NOT NULL))
);
CREATE INDEX private_media_cleanup_pending ON private_media_cleanup(state,lease_until,created_at,object_id) WHERE state<>'complete';
