-- Confirming an import file (#47): the admin confirms it, and its rows are
-- then committed to the active dataset (part, stations, source version,
-- households and voters) by a background job, one transaction per file.

-- AlterEnum
ALTER TYPE "import_file_status" ADD VALUE 'confirming' BEFORE 'confirmed';

-- AlterTable
ALTER TABLE "import_file" ADD COLUMN     "confirmed_by" UUID;

-- AddForeignKey
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

-- A confirmed file has made a source version (a revision of its part).
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_confirmed_check" CHECK (
  "status" <> 'confirmed'
  OR ("source_version_id" IS NOT NULL AND "part_node_id" IS NOT NULL AND "confirmed_at" IS NOT NULL));
