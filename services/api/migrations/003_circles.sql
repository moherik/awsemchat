CREATE TABLE circles (
 id text PRIMARY KEY,
 creator_id text NOT NULL REFERENCES auth_accounts(id),
 operation_id text NOT NULL,
 epoch bigint NOT NULL DEFAULT 1 CHECK(epoch BETWEEN 1 AND 9007199254740991),
 member_count integer NOT NULL CHECK(member_count BETWEEN 0 AND 20),
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 UNIQUE(creator_id,operation_id),
 CHECK((closed_at IS NULL AND member_count>0) OR (closed_at IS NOT NULL AND member_count=0))
);
CREATE TABLE circle_memberships (
 id text PRIMARY KEY,
 circle_id text NOT NULL REFERENCES circles(id),
 account_id text NOT NULL REFERENCES auth_accounts(id),
 role text NOT NULL CHECK(role IN ('admin','member')),
 joined_epoch bigint NOT NULL CHECK(joined_epoch BETWEEN 1 AND 9007199254740991),
 left_epoch bigint CHECK(left_epoch BETWEEN 1 AND 9007199254740991 AND left_epoch>joined_epoch),
 joined_at timestamptz NOT NULL DEFAULT now(),
 left_at timestamptz,
 CHECK((left_epoch IS NULL)=(left_at IS NULL)),
 UNIQUE(id,circle_id,account_id)
);
CREATE UNIQUE INDEX circle_memberships_active ON circle_memberships(circle_id,account_id) WHERE left_epoch IS NULL;
CREATE INDEX circle_memberships_account ON circle_memberships(account_id,circle_id);
CREATE TABLE circle_invites (
 id text PRIMARY KEY,
 circle_id text NOT NULL REFERENCES circles(id),
 inviter_id text NOT NULL REFERENCES auth_accounts(id),
 invitee_id text NOT NULL REFERENCES auth_accounts(id),
 status text NOT NULL CHECK(status IN ('pending','accepted','declined','revoked')),
 created_epoch bigint NOT NULL CHECK(created_epoch BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 accepted_interval_id text,
 CHECK(inviter_id<>invitee_id),
 CHECK(expires_at>created_at),
 CHECK((status='accepted')=(accepted_interval_id IS NOT NULL)),
 FOREIGN KEY(accepted_interval_id,circle_id,invitee_id) REFERENCES circle_memberships(id,circle_id,account_id)
);
CREATE UNIQUE INDEX circle_invites_pending ON circle_invites(circle_id,invitee_id) WHERE status='pending';
CREATE INDEX circle_invites_recipient ON circle_invites(invitee_id,status);
