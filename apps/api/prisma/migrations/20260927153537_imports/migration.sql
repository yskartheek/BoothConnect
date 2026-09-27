-- CreateEnum
CREATE TYPE "import_batch_status" AS ENUM ('uploading', 'processing', 'review', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "import_file_status" AS ENUM ('uploaded', 'extracting', 'needs_review', 'ready', 'confirmed', 'rejected', 'duplicate', 'failed');

-- CreateEnum
CREATE TYPE "extraction_method" AS ENUM ('text', 'ocr');

-- CreateEnum
CREATE TYPE "import_row_status" AS ENUM ('accepted', 'warning', 'rejected');

-- CreateTable
CREATE TABLE "source_version" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "part_node_id" UUID NOT NULL,
    "revision_year" INTEGER NOT NULL,
    "revision_type" TEXT NOT NULL,
    "roll_identification" TEXT NOT NULL,
    "qualifying_date" DATE,
    "published_on" DATE,
    "checksum" TEXT NOT NULL,
    "previous_version_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "target_node_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "status" "import_batch_status" NOT NULL DEFAULT 'uploading',
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_file" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "file_ref" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "import_file_status" NOT NULL DEFAULT 'uploaded',
    "duplicate_of_id" UUID,
    "page_count" INTEGER,
    "detected_header" JSONB,
    "part_node_id" UUID,
    "source_version_id" UUID,
    "extraction_method" "extraction_method",
    "quality_score" DOUBLE PRECISION,
    "printed_totals" JSONB,
    "extracted_totals" JSONB,
    "error" JSONB,
    "extracted_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "import_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_result" (
    "id" UUID NOT NULL,
    "import_file_id" UUID NOT NULL,
    "page" INTEGER NOT NULL,
    "box_index" INTEGER NOT NULL,
    "section_no" INTEGER,
    "serial_no" INTEGER,
    "status" "import_row_status" NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "raw_text" TEXT,
    "extracted_values" JSONB NOT NULL,
    "field_confidence" JSONB NOT NULL DEFAULT '{}',
    "corrected_values" JSONB,
    "corrected_by" UUID,
    "corrected_at" TIMESTAMPTZ,

    CONSTRAINT "import_row_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_version_previous_version_id_key" ON "source_version"("previous_version_id");

-- CreateIndex
CREATE INDEX "source_version_program_id_idx" ON "source_version"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_version_part_node_id_checksum_key" ON "source_version"("part_node_id", "checksum");

-- CreateIndex
CREATE INDEX "import_batch_program_id_created_at_idx" ON "import_batch"("program_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batch_target_node_id_idx" ON "import_batch"("target_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_file_source_version_id_key" ON "import_file"("source_version_id");

-- CreateIndex
CREATE INDEX "import_file_batch_id_status_idx" ON "import_file"("batch_id", "status");

-- CreateIndex
CREATE INDEX "import_file_part_node_id_idx" ON "import_file"("part_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_file_live_checksum_key" ON "import_file"("program_id", "checksum") WHERE (status NOT IN ('duplicate', 'rejected', 'failed'));

-- CreateIndex
CREATE INDEX "import_row_result_import_file_id_status_idx" ON "import_row_result"("import_file_id", "status");

-- CreateIndex
CREATE INDEX "import_row_result_import_file_id_section_no_serial_no_idx" ON "import_row_result"("import_file_id", "section_no", "serial_no");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_result_import_file_id_page_box_index_key" ON "import_row_result"("import_file_id", "page", "box_index");

-- AddForeignKey
ALTER TABLE "source_version" ADD CONSTRAINT "source_version_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "election_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_version" ADD CONSTRAINT "source_version_part_node_id_fkey" FOREIGN KEY ("part_node_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_version" ADD CONSTRAINT "source_version_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "source_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "election_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "election_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "import_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_part_node_id_fkey" FOREIGN KEY ("part_node_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_result" ADD CONSTRAINT "import_row_result_import_file_id_fkey" FOREIGN KEY ("import_file_id") REFERENCES "import_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_result" ADD CONSTRAINT "import_row_result_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

-- Raises unless the geography node exists with one of the allowed types.
CREATE FUNCTION assert_geography_node_type(node_id UUID, allowed "geography_node_type"[], what TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actual "geography_node_type";
BEGIN
  IF node_id IS NULL THEN
    RETURN;
  END IF;
  SELECT "type" INTO actual FROM "geography_node" WHERE "id" = node_id;
  IF actual IS NOT NULL AND NOT (actual = ANY (allowed)) THEN
    RAISE EXCEPTION '% must be a % node, not %', what, array_to_string(allowed, ' or '), actual
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION source_version_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_geography_node_type(NEW."part_node_id", ARRAY['part']::"geography_node_type"[], 'A source version''s part');
  RETURN NEW;
END;
$$;
CREATE TRIGGER "source_version_check" BEFORE INSERT OR UPDATE ON "source_version"
  FOR EACH ROW EXECUTE FUNCTION source_version_check();

-- Uploads can target State, PC, AC or Part (never a polling station), in the
-- batch's own program.
CREATE FUNCTION import_batch_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_geography_node_type(NEW."target_node_id",
    ARRAY['state', 'pc', 'ac', 'part']::"geography_node_type"[], 'An import batch''s target');
  IF NOT EXISTS (SELECT 1 FROM "geography_node"
                  WHERE "id" = NEW."target_node_id" AND "program_id" = NEW."program_id") THEN
    RAISE EXCEPTION 'An import batch''s target must belong to the batch''s program'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "import_batch_check" BEFORE INSERT OR UPDATE ON "import_batch"
  FOR EACH ROW EXECUTE FUNCTION import_batch_check();

-- A file's program is its batch's, and its part (once matched) must be a part
-- inside the batch's target.
CREATE FUNCTION import_file_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_program UUID;
  batch_target UUID;
BEGIN
  SELECT "program_id", "target_node_id" INTO batch_program, batch_target
    FROM "import_batch" WHERE "id" = NEW."batch_id";
  IF batch_program IS NOT NULL AND batch_program <> NEW."program_id" THEN
    RAISE EXCEPTION 'An import file''s program must match its batch'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."part_node_id" IS NOT NULL THEN
    PERFORM assert_geography_node_type(NEW."part_node_id", ARRAY['part']::"geography_node_type"[], 'An import file''s part');
    IF batch_target IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "geography_closure"
          WHERE "ancestor_id" = batch_target AND "descendant_id" = NEW."part_node_id") THEN
      RAISE EXCEPTION 'An import file''s part must be inside the batch''s target'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "import_file_check" BEFORE INSERT OR UPDATE ON "import_file"
  FOR EACH ROW EXECUTE FUNCTION import_file_check();

ALTER TABLE "import_file" ADD CONSTRAINT "import_file_checksum_format_check"
  CHECK ("checksum" ~ '^[0-9a-f]{64}$');
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_duplicate_check"
  CHECK (("status" = 'duplicate') = ("duplicate_of_id" IS NOT NULL));
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_quality_score_check"
  CHECK ("quality_score" IS NULL OR "quality_score" BETWEEN 0 AND 1);
ALTER TABLE "source_version" ADD CONSTRAINT "source_version_checksum_format_check"
  CHECK ("checksum" ~ '^[0-9a-f]{64}$');
ALTER TABLE "import_row_result" ADD CONSTRAINT "import_row_result_position_check"
  CHECK ("page" >= 1 AND "box_index" >= 0);
