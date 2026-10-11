CREATE TABLE friend_links (
 low_id text NOT NULL REFERENCES auth_accounts(id),
 high_id text NOT NULL REFERENCES auth_accounts(id),
 request_id text NOT NULL UNIQUE,
 requested_by text NOT NULL REFERENCES auth_accounts(id),
 status text NOT NULL CHECK(status IN ('pending','accepted','declined')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(low_id,high_id),
 CHECK(low_id<high_id),
 CHECK(requested_by=low_id OR requested_by=high_id)
);
CREATE INDEX friend_links_high ON friend_links(high_id);
CREATE TABLE friend_blocks (
 actor_id text NOT NULL REFERENCES auth_accounts(id),
 target_id text NOT NULL REFERENCES auth_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,target_id),
 CHECK(actor_id<>target_id)
);
CREATE INDEX friend_blocks_target ON friend_blocks(target_id);
