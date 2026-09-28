-- Uploads into an import batch (#44): a roll PDF or a ZIP of PDFs, uploaded
-- straight to the private bucket with presigned multipart URLs. Completing
-- one verifies it and creates an import_file per PDF.

-- CreateEnum
CREATE TYPE "import_upload_kind" AS ENUM ('pdf', 'zip');

-- CreateEnum
CREATE TYPE "import_upload_status" AS ENUM ('pending', 'completed', 'failed');

-- AlterTable
ALTER TABLE "import_file" ADD COLUMN     "upload_id" UUID;

-- CreateTable
CREATE TABLE "import_upload" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "kind" "import_upload_kind" NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "s3_upload_id" TEXT NOT NULL,
    "status" "import_upload_status" NOT NULL DEFAULT 'pending',
    "error" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "import_upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_upload_object_key_key" ON "import_upload"("object_key");

-- CreateIndex
CREATE INDEX "import_upload_batch_id_status_idx" ON "import_upload"("batch_id", "status");

-- AddForeignKey
ALTER TABLE "import_upload" ADD CONSTRAINT "import_upload_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_upload" ADD CONSTRAINT "import_upload_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "import_upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

