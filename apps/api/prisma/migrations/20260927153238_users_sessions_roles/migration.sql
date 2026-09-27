-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "mfa_state" AS ENUM ('not_enrolled', 'enrolled');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('admin', 'campaign_manager', 'volunteer', 'voter');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "mfa_state" "mfa_state" NOT NULL DEFAULT 'not_enrolled',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "geography_node_id" UUID NOT NULL,
    "valid_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_key" ON "app_user"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "app_user_organization_id_idx" ON "app_user"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_refresh_hash_key" ON "session"("refresh_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "role_assignment_user_id_valid_from_idx" ON "role_assignment"("user_id", "valid_from");

-- CreateIndex
CREATE INDEX "role_assignment_geography_node_id_idx" ON "role_assignment"("geography_node_id");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_geography_node_id_fkey" FOREIGN KEY ("geography_node_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

-- A validity window must end after it starts.
ALTER TABLE "role_assignment"
  ADD CONSTRAINT "role_assignment_valid_window_check"
  CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from");

-- Emails are stored lower-case, so uniqueness is case-insensitive.
ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_email_lowercase_check"
  CHECK ("email" IS NULL OR "email" = lower("email"));

-- A role can only be granted on a geography node of the user's own
-- organization (and by a user of that organization).
CREATE FUNCTION role_assignment_check_organization() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  user_org UUID;
  node_org UUID;
  granter_org UUID;
BEGIN
  SELECT "organization_id" INTO user_org FROM "app_user" WHERE "id" = NEW."user_id";
  SELECT p."organization_id" INTO node_org
    FROM "geography_node" n JOIN "election_program" p ON p."id" = n."program_id"
   WHERE n."id" = NEW."geography_node_id";
  IF user_org IS NOT NULL AND node_org IS NOT NULL AND user_org <> node_org THEN
    RAISE EXCEPTION 'A role can only be assigned on a geography node of the user''s organization'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."granted_by" IS NOT NULL THEN
    SELECT "organization_id" INTO granter_org FROM "app_user" WHERE "id" = NEW."granted_by";
    IF granter_org IS DISTINCT FROM user_org THEN
      RAISE EXCEPTION 'A role can only be granted by a user of the same organization'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "role_assignment_check_organization"
  BEFORE INSERT OR UPDATE OF "user_id", "geography_node_id", "granted_by" ON "role_assignment"
  FOR EACH ROW EXECUTE FUNCTION role_assignment_check_organization();
