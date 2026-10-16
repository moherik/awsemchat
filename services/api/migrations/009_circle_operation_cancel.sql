ALTER TABLE circle_membership_operations ADD COLUMN cancelled boolean NOT NULL DEFAULT false;
ALTER TABLE circle_membership_operations ADD CONSTRAINT circle_operation_cancel_not_closed CHECK(NOT cancelled OR NOT closed);
