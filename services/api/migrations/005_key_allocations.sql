ALTER TABLE key_prekeys ADD COLUMN allocated boolean NOT NULL DEFAULT false;
CREATE TABLE key_allocations (
 actor_id text NOT NULL REFERENCES auth_accounts(id),
 actor_generation bigint NOT NULL,
 operation_id text NOT NULL,
 target_id text NOT NULL,
 target_generation bigint NOT NULL,
 circle_id text NOT NULL DEFAULT '',
 epoch bigint NOT NULL DEFAULT 0,
 key_id text NOT NULL,
 PRIMARY KEY(actor_id,actor_generation,operation_id),
 UNIQUE(target_id,target_generation,key_id),
 FOREIGN KEY(target_id,target_generation,key_id) REFERENCES key_prekeys(account_id,generation,key_id)
);
