-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "election_program_type" AS ENUM ('general_election', 'by_election', 'local_body_election', 'campaign');

-- CreateEnum
CREATE TYPE "election_program_status" AS ENUM ('draft', 'active', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "geography_node_type" AS ENUM ('state', 'pc', 'ac', 'part', 'polling_station');

-- CreateTable
CREATE TABLE "organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "organization_status" NOT NULL DEFAULT 'active',
    "default_language" TEXT NOT NULL DEFAULT 'en',
    "policy_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "election_program" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "election_program_type" NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "status" "election_program_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "election_program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geography_node" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "geography_node_type" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_auxiliary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "geography_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geography_closure" (
    "ancestor_id" UUID NOT NULL,
    "descendant_id" UUID NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "geography_closure_pkey" PRIMARY KEY ("ancestor_id","descendant_id")
);

-- CreateIndex
CREATE INDEX "election_program_organization_id_idx" ON "election_program"("organization_id");

-- CreateIndex
CREATE INDEX "geography_node_parent_id_idx" ON "geography_node"("parent_id");

-- CreateIndex
CREATE INDEX "geography_node_program_id_type_idx" ON "geography_node"("program_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "geography_node_sibling_code_key" ON "geography_node"("program_id", "parent_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "geography_node_root_code_key" ON "geography_node"("program_id", "code") WHERE ("parent_id" IS NULL);

-- CreateIndex
CREATE INDEX "geography_closure_descendant_id_depth_idx" ON "geography_closure"("descendant_id", "depth");

-- AddForeignKey
ALTER TABLE "election_program" ADD CONSTRAINT "election_program_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geography_node" ADD CONSTRAINT "geography_node_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "election_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geography_node" ADD CONSTRAINT "geography_node_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "geography_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geography_closure" ADD CONSTRAINT "geography_closure_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "geography_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geography_closure" ADD CONSTRAINT "geography_closure_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "geography_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express (Prisma ignores checks, functions
-- and triggers when diffing, so these don't cause schema drift).
-- ---------------------------------------------------------------------------

-- Only polling stations can be auxiliary.
ALTER TABLE "geography_node"
  ADD CONSTRAINT "geography_node_auxiliary_station_check"
  CHECK (NOT "is_auxiliary" OR "type" = 'polling_station');

-- Before insert: the parent must be the level directly above, in the same
-- program; nodes without a parent must be states.
CREATE FUNCTION geography_node_check_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_type "geography_node_type";
  parent_program UUID;
  expected_parent "geography_node_type";
BEGIN
  expected_parent := CASE NEW."type"
    WHEN 'state' THEN NULL
    WHEN 'pc' THEN 'state'
    WHEN 'ac' THEN 'pc'
    WHEN 'part' THEN 'ac'
    WHEN 'polling_station' THEN 'part'
  END;

  IF NEW."parent_id" IS NULL THEN
    IF expected_parent IS NOT NULL THEN
      RAISE EXCEPTION 'A % must have a % as its parent', NEW."type", expected_parent
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT "type", "program_id" INTO parent_type, parent_program
    FROM "geography_node" WHERE "id" = NEW."parent_id";

  IF parent_type IS NULL THEN
    RETURN NEW; -- the foreign key reports the missing parent
  END IF;
  IF parent_program <> NEW."program_id" THEN
    RAISE EXCEPTION 'A geography node and its parent must belong to the same program'
      USING ERRCODE = 'check_violation';
  END IF;
  IF expected_parent IS DISTINCT FROM parent_type THEN
    RAISE EXCEPTION 'A % can''t be placed under a % (expected parent: %)',
      NEW."type", parent_type, COALESCE(expected_parent::TEXT, 'none')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "geography_node_check_parent"
  BEFORE INSERT ON "geography_node"
  FOR EACH ROW EXECUTE FUNCTION geography_node_check_parent();

-- Before update: the position in the tree is fixed once created, so the
-- closure table never needs rewriting.
CREATE FUNCTION geography_node_prevent_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."parent_id" IS DISTINCT FROM OLD."parent_id"
     OR NEW."type" <> OLD."type"
     OR NEW."program_id" <> OLD."program_id" THEN
    RAISE EXCEPTION 'A geography node''s parent, type and program can''t be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "geography_node_prevent_move"
  BEFORE UPDATE ON "geography_node"
  FOR EACH ROW EXECUTE FUNCTION geography_node_prevent_move();

-- After insert: add the node to the closure table (itself at depth 0, plus
-- every ancestor of its parent one level further away).
CREATE FUNCTION geography_node_add_closure() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "geography_closure" ("ancestor_id", "descendant_id", "depth")
  SELECT NEW."id", NEW."id", 0
  UNION ALL
  SELECT c."ancestor_id", NEW."id", c."depth" + 1
    FROM "geography_closure" c
   WHERE c."descendant_id" = NEW."parent_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "geography_node_add_closure"
  AFTER INSERT ON "geography_node"
  FOR EACH ROW EXECUTE FUNCTION geography_node_add_closure();
