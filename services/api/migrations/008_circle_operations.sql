CREATE TABLE circle_membership_operations (
 circle_id text NOT NULL REFERENCES circles(id),
 actor_id text NOT NULL REFERENCES auth_accounts(id),
 operation_id text NOT NULL,
 request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
 action text NOT NULL CHECK(action IN ('leave','remove','handoff')),
 closed boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(circle_id,actor_id,operation_id)
);
