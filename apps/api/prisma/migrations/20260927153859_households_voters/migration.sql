-- CreateEnum
CREATE TYPE "household_status" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "record_origin" AS ENUM ('official_import', 'volunteer_added');

-- CreateEnum
CREATE TYPE "voter_record_status" AS ENUM ('active', 'superseded', 'deleted');

-- CreateTable
CREATE TABLE "household" (
    "id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "polling_station_id" UUID NOT NULL,
    "house_key" TEXT NOT NULL,
    "display_address" TEXT NOT NULL,
    "structured_address" JSONB NOT NULL DEFAULT '{}',
    "location_lat" DECIMAL(9,6),
    "location_lng" DECIMAL(9,6),
    "location_accuracy_m" DOUBLE PRECISION,
    "location_captured_at" TIMESTAMPTZ,
    "location_consent_id" UUID,
    "origin" "record_origin" NOT NULL DEFAULT 'official_import',
    "source_version_id" UUID,
    "status" "household_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voter" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "polling_station_id" UUID NOT NULL,
    "origin" "record_origin" NOT NULL DEFAULT 'official_import',
    "section_no" INTEGER,
    "serial_no" INTEGER,
    "source_voter_id" TEXT,
    "source_data" JSONB,
    "source_version_id" UUID,
    "import_file_id" UUID,
    "record_status" "voter_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "voter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "household_polling_station_id_status_idx" ON "household"("polling_station_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "household_part_id_house_key_key" ON "household"("part_id", "house_key");

-- CreateIndex
CREATE INDEX "voter_polling_station_id_record_status_idx" ON "voter"("polling_station_id", "record_status");

-- CreateIndex
CREATE INDEX "voter_part_id_record_status_idx" ON "voter"("part_id", "record_status");

-- CreateIndex
CREATE INDEX "voter_household_id_idx" ON "voter"("household_id");

-- CreateIndex
CREATE INDEX "voter_program_id_source_voter_id_idx" ON "voter"("program_id", "source_voter_id");

-- CreateIndex
CREATE UNIQUE INDEX "voter_program_id_source_version_id_source_voter_id_key" ON "voter"("program_id", "source_version_id", "source_voter_id");

-- CreateIndex
CREATE UNIQUE INDEX "voter_part_id_source_version_id_serial_no_key" ON "voter"("part_id", "source_version_id", "serial_no");

-- AddForeignKey
ALTER TABLE "household" ADD CONSTRAINT "household_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household" ADD CONSTRAINT "household_polling_station_id_fkey" FOREIGN KEY ("polling_station_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household" ADD CONSTRAINT "household_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter" ADD CONSTRAINT "voter_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "election_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter" ADD CONSTRAINT "voter_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter" ADD CONSTRAINT "voter_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter" ADD CONSTRAINT "voter_polling_station_id_fkey" FOREIGN KEY ("polling_station_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter" ADD CONSTRAINT "voter_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter" ADD CONSTRAINT "voter_import_file_id_fkey" FOREIGN KEY ("import_file_id") REFERENCES "import_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

-- Official members carry the roll entry; volunteer-added members have none
-- (their details live in field_value, spec v1.1).
ALTER TABLE "voter" ADD CONSTRAINT "voter_origin_check" CHECK (
  CASE "origin"
    WHEN 'official_import' THEN
      "source_voter_id" IS NOT NULL AND "source_data" IS NOT NULL AND "source_version_id" IS NOT NULL
      AND "import_file_id" IS NOT NULL AND "section_no" IS NOT NULL AND "serial_no" IS NOT NULL
    ELSE
      "source_data" IS NULL AND "source_version_id" IS NULL AND "import_file_id" IS NULL
      AND "section_no" IS NULL AND "serial_no" IS NULL
  END);
ALTER TABLE "voter" ADD CONSTRAINT "voter_position_check"
  CHECK ("section_no" IS NULL OR ("section_no" >= 1 AND "serial_no" >= 1));
ALTER TABLE "voter" ADD CONSTRAINT "voter_source_data_object_check"
  CHECK ("source_data" IS NULL OR jsonb_typeof("source_data") = 'object');

ALTER TABLE "household" ADD CONSTRAINT "household_origin_check" CHECK (
  ("origin" = 'official_import') = ("source_version_id" IS NOT NULL));
ALTER TABLE "household" ADD CONSTRAINT "household_structured_address_object_check"
  CHECK (jsonb_typeof("structured_address") = 'object');
-- A location is all-or-nothing, within range, and always needs consent.
ALTER TABLE "household" ADD CONSTRAINT "household_location_check" CHECK (
  ("location_lat" IS NULL AND "location_lng" IS NULL AND "location_accuracy_m" IS NULL
   AND "location_captured_at" IS NULL AND "location_consent_id" IS NULL)
  OR ("location_lat" BETWEEN -90 AND 90 AND "location_lng" BETWEEN -180 AND 180
      AND "location_captured_at" IS NOT NULL AND "location_consent_id" IS NOT NULL
      AND ("location_accuracy_m" IS NULL OR "location_accuracy_m" >= 0)));

-- The official record never changes after import: volunteer edits go to
-- field_value as current values. Which revision, part, file and position a
-- voter came from can't change either, nor can its origin. (Moving to another
-- station of the same part is fine: auxiliary-station coverage can move.)
CREATE FUNCTION voter_protect_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."source_data" IS DISTINCT FROM OLD."source_data"
     OR NEW."source_voter_id" IS DISTINCT FROM OLD."source_voter_id"
     OR NEW."source_version_id" IS DISTINCT FROM OLD."source_version_id"
     OR NEW."import_file_id" IS DISTINCT FROM OLD."import_file_id"
     OR NEW."origin" <> OLD."origin"
     OR NEW."part_id" <> OLD."part_id"
     OR NEW."section_no" IS DISTINCT FROM OLD."section_no"
     OR NEW."serial_no" IS DISTINCT FROM OLD."serial_no" THEN
    RAISE EXCEPTION 'A voter''s source data is the official record and can''t be changed; record edits as field values'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "voter_protect_source" BEFORE UPDATE ON "voter"
  FOR EACH ROW EXECUTE FUNCTION voter_protect_source();

-- Raises unless station_id is a polling station directly under part_id.
CREATE FUNCTION assert_station_in_part(station_id UUID, part_id UUID, what TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_geography_node_type(part_id, ARRAY['part']::"geography_node_type"[], what || '''s part');
  IF NOT EXISTS (SELECT 1 FROM "geography_node"
                  WHERE "id" = station_id AND "parent_id" = part_id AND "type" = 'polling_station') THEN
    RAISE EXCEPTION '%''s polling station must be a station of its part', what
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION household_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_station_in_part(NEW."polling_station_id", NEW."part_id", 'A household');
  IF NEW."source_version_id" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "source_version"
        WHERE "id" = NEW."source_version_id" AND "part_node_id" = NEW."part_id") THEN
    RAISE EXCEPTION 'A household''s source version must be a revision of its part'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "household_check" BEFORE INSERT OR UPDATE ON "household"
  FOR EACH ROW EXECUTE FUNCTION household_check();

-- A voter's station, household and source version all belong to its part.
CREATE FUNCTION voter_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_station_in_part(NEW."polling_station_id", NEW."part_id", 'A voter');
  IF NOT EXISTS (SELECT 1 FROM "household"
                  WHERE "id" = NEW."household_id" AND "part_id" = NEW."part_id") THEN
    RAISE EXCEPTION 'A voter''s household must be in the voter''s part'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."source_version_id" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "source_version"
        WHERE "id" = NEW."source_version_id" AND "part_node_id" = NEW."part_id") THEN
    RAISE EXCEPTION 'A voter''s source version must be a revision of the voter''s part'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "voter_check" BEFORE INSERT OR UPDATE OF "polling_station_id", "household_id" ON "voter"
  FOR EACH ROW EXECUTE FUNCTION voter_check();
