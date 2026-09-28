-- Household address and location as field values (#112), so edits get the
-- same base_version conflict checks and history as member fields. The
-- household row keeps a copy of the current values (structured_address,
-- display_address, location_*) for lists and search.
ALTER TYPE "field_type" ADD VALUE 'address';
ALTER TYPE "field_type" ADD VALUE 'location';
