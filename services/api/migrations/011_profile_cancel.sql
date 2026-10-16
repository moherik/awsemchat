CREATE TABLE profile_operation_cancellations (
 sender_id text NOT NULL REFERENCES auth_accounts(id),
 sender_generation bigint NOT NULL CHECK(sender_generation>0),
 operation_id text NOT NULL,
 digest bytea NOT NULL CHECK(octet_length(digest)=32),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(sender_id,sender_generation,operation_id)
);
