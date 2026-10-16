CREATE TABLE circle_collection_snapshots (
 circle_id text NOT NULL REFERENCES circles(id),
 snapshot_id text NOT NULL,
 sender_id text NOT NULL REFERENCES auth_accounts(id),
 sender_generation bigint NOT NULL CHECK(sender_generation > 0),
 epoch bigint NOT NULL CHECK(epoch BETWEEN 1 AND 9007199254740991),
 revision bigint NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
 parts integer NOT NULL CHECK(parts BETWEEN 1 AND 256),
 completed_at timestamptz,
 PRIMARY KEY(circle_id,snapshot_id)
);
CREATE TABLE circle_collection_snapshot_parts (
 circle_id text NOT NULL,
 snapshot_id text NOT NULL,
 part integer NOT NULL CHECK(part BETWEEN 0 AND 255),
 operation_id text NOT NULL,
 PRIMARY KEY(circle_id,snapshot_id,part),
 FOREIGN KEY(circle_id,snapshot_id) REFERENCES circle_collection_snapshots(circle_id,snapshot_id)
);
CREATE TABLE circle_collection_snapshot_entries (
 circle_id text NOT NULL,
 snapshot_id text NOT NULL,
 part integer NOT NULL,
 item_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sticker','emoji')),
 PRIMARY KEY(circle_id,snapshot_id,item_id),
 FOREIGN KEY(circle_id,snapshot_id,part) REFERENCES circle_collection_snapshot_parts(circle_id,snapshot_id,part),
 FOREIGN KEY(circle_id,item_id) REFERENCES circle_collection_items(circle_id,item_id)
);
