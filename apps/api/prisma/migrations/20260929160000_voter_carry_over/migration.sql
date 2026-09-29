-- Carrying volunteer data over to the same voter in a new roll revision
-- (#161): a new voter record links to the one it replaced, and the current
-- field values are copied to it, each linked to the value it came from. The
-- old record and its values are left as they are.

-- AlterTable
ALTER TABLE "voter" ADD COLUMN "previous_voter_id" UUID;
ALTER TABLE "field_value" ADD COLUMN "carried_from_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "voter_previous_voter_id_key" ON "voter"("previous_voter_id");
CREATE UNIQUE INDEX "field_value_carried_from_id_key" ON "field_value"("carried_from_id");

-- AddForeignKey
ALTER TABLE "voter" ADD CONSTRAINT "voter_previous_voter_id_fkey" FOREIGN KEY ("previous_voter_id") REFERENCES "voter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_carried_from_id_fkey" FOREIGN KEY ("carried_from_id") REFERENCES "field_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The previous record is the same voter: same program and EPIC, and not
-- the record itself. The link is set when the record is created and never
-- changes.
CREATE FUNCTION voter_check_previous() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."previous_voter_id" IS DISTINCT FROM OLD."previous_voter_id" THEN
    RAISE EXCEPTION 'A voter''s previous record is set when it is created and can''t change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."previous_voter_id" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "voter" p
        WHERE p."id" = NEW."previous_voter_id" AND p."id" <> NEW."id"
          AND p."program_id" = NEW."program_id"
          AND p."source_voter_id" IS NOT NULL
          AND p."source_voter_id" = NEW."source_voter_id") THEN
    RAISE EXCEPTION 'A voter''s previous record must be the same voter (same program and EPIC)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "voter_check_previous" BEFORE INSERT OR UPDATE ON "voter"
  FOR EACH ROW EXECUTE FUNCTION voter_check_previous();

-- A carried value is a copy of a value of the same field on the voter's
-- previous record.
CREATE FUNCTION field_value_check_carried() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM "field_value" src JOIN "voter" v ON v."previous_voter_id" = src."entity_id"
        WHERE src."id" = NEW."carried_from_id"
          AND src."entity_type" = 'voter' AND NEW."entity_type" = 'voter'
          AND v."id" = NEW."entity_id"
          AND src."field_definition_id" = NEW."field_definition_id"
          AND src."value" = NEW."value"
          AND src."consent_id" IS NOT DISTINCT FROM NEW."consent_id") THEN
    RAISE EXCEPTION 'A carried value must copy a value of the same field on the voter''s previous record'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "field_value_check_carried" BEFORE INSERT ON "field_value"
  FOR EACH ROW WHEN (NEW."carried_from_id" IS NOT NULL)
  EXECUTE FUNCTION field_value_check_carried();

-- A voter's records, newest first: the record itself, then each record it
-- replaced.
CREATE FUNCTION voter_lineage(voter_id UUID) RETURNS TABLE (id UUID, depth INT) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, previous_id, depth) AS (
    SELECT v."id", v."previous_voter_id", 0 FROM "voter" v WHERE v."id" = voter_id
    UNION ALL
    SELECT p."id", p."previous_voter_id", c.depth + 1
      FROM chain c JOIN "voter" p ON p."id" = c.previous_id
     WHERE c.depth < 100
  )
  SELECT chain.id, chain.depth FROM chain
$$;

-- A consent given on a voter's earlier record still covers the voter: consent
-- rows are never rewritten, so it is resolved through the link.
CREATE OR REPLACE FUNCTION assert_consent_covers(consent_id UUID, expected_purpose TEXT, entity "field_entity", entity_id UUID)
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
  IF (entity = 'voter' AND (c."subject_voter_id" IS NULL
                            OR c."subject_voter_id" NOT IN (SELECT l.id FROM voter_lineage(entity_id) l)))
     OR (entity = 'household' AND c."subject_household_id" IS DISTINCT FROM entity_id
         AND NOT EXISTS (SELECT 1 FROM "voter" v
                          WHERE v."id" = c."subject_voter_id" AND v."household_id" = entity_id)) THEN
    RAISE EXCEPTION 'The consent record was given by someone else'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Field values: as before, except that a carried value may keep a field that
-- has been disabled since.
CREATE OR REPLACE FUNCTION field_value_check_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  def RECORD;
  old_value RECORD;
BEGIN
  SELECT "enabled", "applies_to", "requires_consent", "key" INTO def
    FROM "field_definition" WHERE "id" = NEW."field_definition_id";
  IF FOUND THEN
    -- A value carried over to a voter's new record (#161) keeps a field
    -- that has since been disabled; nothing new is collected.
    IF NOT def."enabled" AND NEW."carried_from_id" IS NULL THEN
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
