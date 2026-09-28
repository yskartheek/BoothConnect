-- Sync change marker (#42). Each synced row carries the ID of the transaction
-- that last wrote it. GET /v1/sync/pull puts its database snapshot in the
-- cursor: xmax (the first transaction ID not yet handed out) and the IDs still
-- running. The next pull asks for exactly the rows that snapshot couldn't see:
-- change_xid >= xmax, or one of the running IDs. So a slow transaction that
-- commits after the pull is never skipped (timestamps would miss it), and
-- nothing already sent is sent again.

-- AlterTable
ALTER TABLE "consent" ADD COLUMN     "change_xid" BIGINT NOT NULL DEFAULT ((pg_current_xact_id())::text)::bigint;

-- AlterTable
ALTER TABLE "field_definition" ADD COLUMN     "change_xid" BIGINT NOT NULL DEFAULT ((pg_current_xact_id())::text)::bigint;

-- AlterTable
ALTER TABLE "field_value" ADD COLUMN     "change_xid" BIGINT NOT NULL DEFAULT ((pg_current_xact_id())::text)::bigint;

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "change_xid" BIGINT NOT NULL DEFAULT ((pg_current_xact_id())::text)::bigint;

-- AlterTable
ALTER TABLE "visit" ADD COLUMN     "change_xid" BIGINT NOT NULL DEFAULT ((pg_current_xact_id())::text)::bigint;

-- AlterTable
ALTER TABLE "voter" ADD COLUMN     "change_xid" BIGINT NOT NULL DEFAULT ((pg_current_xact_id())::text)::bigint;

-- CreateIndex
CREATE INDEX "consent_change_xid_idx" ON "consent"("change_xid");

-- CreateIndex
CREATE INDEX "field_definition_program_id_change_xid_idx" ON "field_definition"("program_id", "change_xid");

-- CreateIndex
CREATE INDEX "field_value_change_xid_idx" ON "field_value"("change_xid");

-- CreateIndex
CREATE INDEX "household_polling_station_id_change_xid_idx" ON "household"("polling_station_id", "change_xid");

-- CreateIndex
CREATE INDEX "visit_household_id_change_xid_idx" ON "visit"("household_id", "change_xid");

-- CreateIndex
CREATE INDEX "voter_polling_station_id_change_xid_idx" ON "voter"("polling_station_id", "change_xid");

-- The database sets the marker on every insert and update; clients can't.
CREATE FUNCTION sync_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."change_xid" := (pg_current_xact_id())::text::bigint;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "household_sync_touch" BEFORE INSERT OR UPDATE ON "household"
  FOR EACH ROW EXECUTE FUNCTION sync_touch();
CREATE TRIGGER "voter_sync_touch" BEFORE INSERT OR UPDATE ON "voter"
  FOR EACH ROW EXECUTE FUNCTION sync_touch();
CREATE TRIGGER "field_definition_sync_touch" BEFORE INSERT OR UPDATE ON "field_definition"
  FOR EACH ROW EXECUTE FUNCTION sync_touch();
CREATE TRIGGER "field_value_sync_touch" BEFORE INSERT OR UPDATE ON "field_value"
  FOR EACH ROW EXECUTE FUNCTION sync_touch();
CREATE TRIGGER "visit_sync_touch" BEFORE INSERT ON "visit"
  FOR EACH ROW EXECUTE FUNCTION sync_touch();
CREATE TRIGGER "consent_sync_touch" BEFORE INSERT OR UPDATE ON "consent"
  FOR EACH ROW EXECUTE FUNCTION sync_touch();

-- The append-only checks compare whole rows; the marker is allowed to move.
CREATE OR REPLACE FUNCTION field_value_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'is_current' - 'conflict_with_id' - 'change_xid')
     IS DISTINCT FROM (to_jsonb(OLD) - 'is_current' - 'conflict_with_id' - 'change_xid')
     OR (NEW."is_current" AND NOT OLD."is_current")
     OR (NEW."conflict_with_id" IS NOT NULL AND NEW."conflict_with_id" IS DISTINCT FROM OLD."conflict_with_id") THEN
    RAISE EXCEPTION 'Field values are append-only; record a change as a new value that supersedes this one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION consent_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Consent records can''t be deleted; withdraw them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'withdrawn'
     OR (to_jsonb(NEW) - 'status' - 'withdrawn_at' - 'withdrawn_by' - 'change_xid')
        IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'withdrawn_at' - 'withdrawn_by' - 'change_xid') THEN
    RAISE EXCEPTION 'A consent record can only be withdrawn; record new consent as a new record'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
