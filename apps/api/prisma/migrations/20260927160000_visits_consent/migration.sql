-- CreateEnum
CREATE TYPE "visit_outcome" AS ENUM ('completed', 'partially_completed', 'no_one_available', 'refused', 'address_not_found', 'household_moved', 'voter_deceased', 'duplicate_or_incorrect_listing', 'follow_up_requested', 'unsafe_or_inaccessible');

-- CreateEnum
CREATE TYPE "consent_status" AS ENUM ('granted', 'withdrawn');

-- CreateEnum
CREATE TYPE "consent_method" AS ENUM ('in_person_verbal', 'in_person_signed', 'self_service');

-- CreateTable
CREATE TABLE "visit" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "volunteer_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "outcome" "visit_outcome" NOT NULL,
    "form_version" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "notes" TEXT,
    "corrects_visit_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_member" (
    "visit_id" UUID NOT NULL,
    "voter_id" UUID NOT NULL,

    CONSTRAINT "visit_member_pkey" PRIMARY KEY ("visit_id","voter_id")
);

-- CreateTable
CREATE TABLE "consent" (
    "id" UUID NOT NULL,
    "subject_voter_id" UUID,
    "subject_household_id" UUID,
    "purpose" TEXT NOT NULL,
    "notice_version" TEXT NOT NULL,
    "status" "consent_status" NOT NULL DEFAULT 'granted',
    "captured_method" "consent_method" NOT NULL,
    "captured_by" UUID,
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ,
    "withdrawn_by" UUID,

    CONSTRAINT "consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_client_id_key" ON "visit"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_corrects_visit_id_key" ON "visit"("corrects_visit_id");

-- CreateIndex
CREATE INDEX "visit_household_id_started_at_idx" ON "visit"("household_id", "started_at");

-- CreateIndex
CREATE INDEX "visit_volunteer_id_started_at_idx" ON "visit"("volunteer_id", "started_at");

-- CreateIndex
CREATE INDEX "visit_member_voter_id_idx" ON "visit_member"("voter_id");

-- CreateIndex
CREATE INDEX "consent_subject_voter_id_purpose_idx" ON "consent"("subject_voter_id", "purpose");

-- CreateIndex
CREATE INDEX "consent_subject_household_id_purpose_idx" ON "consent"("subject_household_id", "purpose");

-- AddForeignKey
ALTER TABLE "household" ADD CONSTRAINT "household_location_consent_id_fkey" FOREIGN KEY ("location_consent_id") REFERENCES "consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_corrects_visit_id_fkey" FOREIGN KEY ("corrects_visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_member" ADD CONSTRAINT "visit_member_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_member" ADD CONSTRAINT "visit_member_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "voter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_subject_voter_id_fkey" FOREIGN KEY ("subject_voter_id") REFERENCES "voter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_subject_household_id_fkey" FOREIGN KEY ("subject_household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_captured_by_fkey" FOREIGN KEY ("captured_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_withdrawn_by_fkey" FOREIGN KEY ("withdrawn_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

-- Consent: exactly one subject; withdrawn exactly when it has a withdrawal time.
ALTER TABLE "consent" ADD CONSTRAINT "consent_one_subject_check"
  CHECK (num_nonnulls("subject_voter_id", "subject_household_id") = 1);
ALTER TABLE "consent" ADD CONSTRAINT "consent_withdrawal_check"
  CHECK (("status" = 'withdrawn') = ("withdrawn_at" IS NOT NULL));

-- A consent record never changes, except to be withdrawn (once). It's never deleted.
CREATE FUNCTION consent_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Consent records can''t be deleted; withdraw them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'withdrawn'
     OR (to_jsonb(NEW) - 'status' - 'withdrawn_at' - 'withdrawn_by')
        IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'withdrawn_at' - 'withdrawn_by') THEN
    RAISE EXCEPTION 'A consent record can only be withdrawn; record new consent as a new record'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "consent_protect" BEFORE UPDATE OR DELETE ON "consent"
  FOR EACH ROW EXECUTE FUNCTION consent_protect();

-- Raises unless the consent is granted, for this purpose, and given by this
-- entity (for a household: the household itself or one of its members).
CREATE FUNCTION assert_consent_covers(consent_id UUID, expected_purpose TEXT, entity "field_entity", entity_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c RECORD;
BEGIN
  SELECT * INTO c FROM "consent" WHERE "id" = consent_id;
  IF NOT FOUND THEN
    RETURN; -- the foreign key reports it
  END IF;
  IF c."status" <> 'granted' THEN
    RAISE EXCEPTION 'The consent record has been withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  IF c."purpose" <> expected_purpose THEN
    RAISE EXCEPTION 'The consent record is for "%", not "%"', c."purpose", expected_purpose
      USING ERRCODE = 'check_violation';
  END IF;
  IF (entity = 'voter' AND c."subject_voter_id" IS DISTINCT FROM entity_id)
     OR (entity = 'household' AND c."subject_household_id" IS DISTINCT FROM entity_id
         AND NOT EXISTS (SELECT 1 FROM "voter" v
                          WHERE v."id" = c."subject_voter_id" AND v."household_id" = entity_id)) THEN
    RAISE EXCEPTION 'The consent record was given by someone else'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Field values: the consent must cover the field and the entity.
CREATE OR REPLACE FUNCTION field_value_check_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  def RECORD;
  old_value RECORD;
BEGIN
  SELECT "enabled", "applies_to", "requires_consent", "key" INTO def
    FROM "field_definition" WHERE "id" = NEW."field_definition_id";
  IF FOUND THEN
    IF NOT def."enabled" THEN
      RAISE EXCEPTION 'Field "%" is disabled; values can''t be written', def."key"
        USING ERRCODE = 'check_violation';
    END IF;
    IF def."applies_to" <> NEW."entity_type" THEN
      RAISE EXCEPTION 'Field "%" applies to %, not %', def."key", def."applies_to", NEW."entity_type"
        USING ERRCODE = 'check_violation';
    END IF;
    IF def."requires_consent" AND NEW."consent_id" IS NULL THEN
      RAISE EXCEPTION 'Field "%" requires a consent record', def."key"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."consent_id" IS NOT NULL THEN
      PERFORM assert_consent_covers(NEW."consent_id", def."key", NEW."entity_type", NEW."entity_id");
    END IF;
  END IF;

  IF (NEW."entity_type" = 'voter' AND NOT EXISTS (SELECT 1 FROM "voter" WHERE "id" = NEW."entity_id"))
     OR (NEW."entity_type" = 'household' AND NOT EXISTS (SELECT 1 FROM "household" WHERE "id" = NEW."entity_id")) THEN
    RAISE EXCEPTION 'No % with id %', NEW."entity_type", NEW."entity_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW."supersedes_id" IS NOT NULL THEN
    SELECT "entity_type", "entity_id", "field_definition_id" INTO old_value
      FROM "field_value" WHERE "id" = NEW."supersedes_id";
    IF FOUND AND (old_value."entity_type" <> NEW."entity_type"
                  OR old_value."entity_id" <> NEW."entity_id"
                  OR old_value."field_definition_id" <> NEW."field_definition_id") THEN
      RAISE EXCEPTION 'A value can only replace a value of the same entity and field'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW."conflict_with_id" IS NOT NULL THEN
    SELECT "entity_type", "entity_id", "field_definition_id" INTO old_value
      FROM "field_value" WHERE "id" = NEW."conflict_with_id";
    IF FOUND AND (old_value."entity_type" <> NEW."entity_type"
                  OR old_value."entity_id" <> NEW."entity_id"
                  OR old_value."field_definition_id" <> NEW."field_definition_id") THEN
      RAISE EXCEPTION 'A value can only conflict with a value of the same entity and field'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW."is_current" := TRUE;
  RETURN NEW;
END;
$$;

-- Household location: its consent must be granted for "household_location" by
-- the household or one of its members.
CREATE FUNCTION household_check_location_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."location_consent_id" IS NOT NULL
     AND NEW."location_consent_id" IS DISTINCT FROM OLD."location_consent_id" THEN
    PERFORM assert_consent_covers(NEW."location_consent_id", 'household_location', 'household', NEW."id");
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "household_check_location_consent"
  BEFORE UPDATE OF "location_consent_id" ON "household"
  FOR EACH ROW EXECUTE FUNCTION household_check_location_consent();
CREATE FUNCTION household_check_location_consent_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."location_consent_id" IS NOT NULL THEN
    PERFORM assert_consent_covers(NEW."location_consent_id", 'household_location', 'household', NEW."id");
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "household_check_location_consent_insert"
  BEFORE INSERT ON "household"
  FOR EACH ROW EXECUTE FUNCTION household_check_location_consent_insert();

-- Visits: completion after start; the volunteer belongs to the household's
-- organization; a correction concerns the same household.
ALTER TABLE "visit" ADD CONSTRAINT "visit_times_check"
  CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at");

CREATE FUNCTION visit_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1
         FROM "household" h
         JOIN "geography_node" n ON n."id" = h."part_id"
         JOIN "election_program" p ON p."id" = n."program_id"
         JOIN "app_user" u ON u."organization_id" = p."organization_id"
        WHERE h."id" = NEW."household_id" AND u."id" = NEW."volunteer_id") THEN
    RAISE EXCEPTION 'A visit''s volunteer must belong to the household''s organization'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."corrects_visit_id" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "visit" WHERE "id" = NEW."corrects_visit_id" AND "household_id" = NEW."household_id") THEN
    RAISE EXCEPTION 'A correction must be for a visit to the same household'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "visit_check" BEFORE INSERT ON "visit"
  FOR EACH ROW EXECUTE FUNCTION visit_check();

-- The members met must live in the visited household.
CREATE FUNCTION visit_member_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM "visit" vi JOIN "voter" vo ON vo."household_id" = vi."household_id"
        WHERE vi."id" = NEW."visit_id" AND vo."id" = NEW."voter_id") THEN
    RAISE EXCEPTION 'A member met on a visit must belong to the visited household'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "visit_member_check" BEFORE INSERT ON "visit_member"
  FOR EACH ROW EXECUTE FUNCTION visit_member_check();

-- Visit history is immutable (spec §7.4): corrections are new visits.
CREATE FUNCTION visit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Visit history is immutable; record a correction as a new visit'
    USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "visit_immutable" BEFORE UPDATE OR DELETE ON "visit"
  FOR EACH ROW EXECUTE FUNCTION visit_immutable();
CREATE TRIGGER "visit_member_immutable" BEFORE UPDATE OR DELETE ON "visit_member"
  FOR EACH ROW EXECUTE FUNCTION visit_immutable();
