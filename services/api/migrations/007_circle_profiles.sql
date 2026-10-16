ALTER TABLE circles ADD COLUMN profile_revision bigint NOT NULL DEFAULT 0
 CHECK (profile_revision >= 0 AND profile_revision <= 9007199254740991);
