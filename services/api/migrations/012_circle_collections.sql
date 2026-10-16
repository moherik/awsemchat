ALTER TABLE circles ADD COLUMN collection_revision bigint NOT NULL DEFAULT 0
 CHECK(collection_revision BETWEEN 0 AND 9007199254740991);
CREATE TABLE circle_collection_items (
 circle_id text NOT NULL REFERENCES circles(id),
 item_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sticker','emoji')),
 contributor_id text NOT NULL REFERENCES auth_accounts(id),
 added_revision bigint NOT NULL CHECK(added_revision BETWEEN 1 AND 9007199254740991),
 removed_revision bigint CHECK(removed_revision > added_revision AND removed_revision <= 9007199254740991),
 PRIMARY KEY(circle_id,item_id)
);
