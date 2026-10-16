ALTER TABLE circle_media_objects
 ADD COLUMN owner_generation bigint CHECK(owner_generation IS NULL OR owner_generation>0),
 ADD COLUMN operation_id text;

CREATE TABLE message_operation_cancellations (
 sender_id text NOT NULL REFERENCES auth_accounts(id),
 sender_generation bigint NOT NULL CHECK(sender_generation>0),
 operation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(sender_id,sender_generation,operation_id)
);

CREATE TABLE circle_media_cleanup (
 object_id text PRIMARY KEY REFERENCES circle_media_objects(id),
 circle_id text NOT NULL REFERENCES circles(id),
 owner_id text NOT NULL REFERENCES auth_accounts(id),
 owner_generation bigint NOT NULL CHECK(owner_generation>0),
 operation_id text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','complete')),
 created_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 completed_at timestamptz,
 CHECK((state='pending' AND lease_until IS NULL AND completed_at IS NULL) OR (state='processing' AND lease_until IS NOT NULL AND completed_at IS NULL) OR (state='complete' AND lease_until IS NULL AND completed_at IS NOT NULL))
);

CREATE INDEX circle_media_cleanup_pending ON circle_media_cleanup(state,lease_until,created_at,object_id) WHERE state<>'complete';
