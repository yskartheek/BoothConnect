-- CreateEnum
CREATE TYPE "field_type" AS ENUM ('text', 'number', 'boolean', 'date', 'phone', 'single_select', 'multi_select');

-- CreateEnum
CREATE TYPE "field_entity" AS ENUM ('voter', 'household');

-- CreateEnum
CREATE TYPE "value_source" AS ENUM ('official_import', 'voter_self_submitted', 'volunteer_collected', 'admin_corrected', 'derived');

-- CreateTable
CREATE TABLE "field_definition" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label_key" TEXT NOT NULL,
    "applies_to" "field_entity" NOT NULL,
    "type" "field_type" NOT NULL,
    "options" JSONB,
    "is_restricted" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "requires_consent" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT NOT NULL,
    "legal_basis" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "field_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_value" (
    "id" UUID NOT NULL,
    "entity_type" "field_entity" NOT NULL,
    "entity_id" UUID NOT NULL,
    "field_definition_id" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "source_type" "value_source" NOT NULL,
    "consent_id" UUID,
    "collected_by" UUID,
    "collected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedes_id" UUID,
    "base_version" UUID,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "conflict_with_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "field_definition_program_id_key_key" ON "field_definition"("program_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "field_value_supersedes_id_key" ON "field_value"("supersedes_id");

-- CreateIndex
CREATE INDEX "field_value_current_idx" ON "field_value"("entity_type", "entity_id", "field_definition_id") WHERE (is_current);

-- CreateIndex
CREATE INDEX "field_value_field_definition_id_idx" ON "field_value"("field_definition_id");

-- CreateIndex
CREATE INDEX "field_value_conflict_with_id_idx" ON "field_value"("conflict_with_id");

-- AddForeignKey
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "election_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_field_definition_id_fkey" FOREIGN KEY ("field_definition_id") REFERENCES "field_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_collected_by_fkey" FOREIGN KEY ("collected_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "field_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_conflict_with_id_fkey" FOREIGN KEY ("conflict_with_id") REFERENCES "field_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

-- A restricted field can only be enabled with consent and a documented legal
-- basis (spec §7.3).
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_restricted_enable_check"
  CHECK (NOT ("is_restricted" AND "enabled")
         OR ("requires_consent" AND "legal_basis" IS NOT NULL AND length(trim("legal_basis")) > 0));

-- Before insert: the field must be enabled and apply to this kind of entity;
-- the entity must exist; consent fields need a consent id; a replacement
-- must replace a value of the same entity and field.
CREATE FUNCTION field_value_check_insert() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER "field_value_check_insert" BEFORE INSERT ON "field_value"
  FOR EACH ROW EXECUTE FUNCTION field_value_check_insert();

-- After insert: the replaced value is no longer current.
CREATE FUNCTION field_value_mark_superseded() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "field_value" SET "is_current" = FALSE WHERE "id" = NEW."supersedes_id";
  RETURN NULL;
END;
$$;
CREATE TRIGGER "field_value_mark_superseded" AFTER INSERT ON "field_value"
  FOR EACH ROW WHEN (NEW."supersedes_id" IS NOT NULL)
  EXECUTE FUNCTION field_value_mark_superseded();

-- Values are append-only. The only changes allowed on an existing value are
-- the ones that resolve history and conflicts: is_current true → false, and
-- conflict_with_id cleared when the volunteer chooses which value to keep.
CREATE FUNCTION field_value_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'is_current' - 'conflict_with_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'is_current' - 'conflict_with_id')
     OR (NEW."is_current" AND NOT OLD."is_current")
     OR (NEW."conflict_with_id" IS NOT NULL AND NEW."conflict_with_id" IS DISTINCT FROM OLD."conflict_with_id") THEN
    RAISE EXCEPTION 'Field values are append-only; record a change as a new value that supersedes this one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "field_value_append_only" BEFORE UPDATE ON "field_value"
  FOR EACH ROW EXECUTE FUNCTION field_value_append_only();
CREATE FUNCTION field_value_append_only_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Field values are append-only and can''t be deleted'
    USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "field_value_no_delete" BEFORE DELETE ON "field_value"
  FOR EACH ROW EXECUTE FUNCTION field_value_append_only_delete();
