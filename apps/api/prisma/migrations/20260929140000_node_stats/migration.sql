-- Per-node analytics (#102; design §7): each geography node's own counts and
-- its subtree totals, and a queue of nodes waiting to be refreshed.

-- CreateTable
CREATE TABLE "node_stats" (
    "node_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "own" JSONB NOT NULL DEFAULT '{}',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_stats_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "node_stats_request" (
    "node_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_stats_request_pkey" PRIMARY KEY ("node_id")
);

-- CreateIndex
CREATE INDEX "node_stats_program_id_idx" ON "node_stats"("program_id");

-- AddForeignKey
ALTER TABLE "node_stats" ADD CONSTRAINT "node_stats_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "geography_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_stats_request" ADD CONSTRAINT "node_stats_request_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "geography_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

ALTER TABLE "node_stats" ADD CONSTRAINT "node_stats_objects_check"
  CHECK (jsonb_typeof("own") = 'object' AND jsonb_typeof("metrics") = 'object');
