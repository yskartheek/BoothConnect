-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('success', 'denied', 'failure');

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "session_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "result" "audit_result" NOT NULL,
    "request_id" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_user_id_key_key" ON "idempotency_record"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_seq_key" ON "audit_event"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_hash_key" ON "audit_event"("hash");

-- CreateIndex
CREATE INDEX "audit_event_actor_id_at_idx" ON "audit_event"("actor_id", "at");

-- CreateIndex
CREATE INDEX "audit_event_resource_type_resource_id_idx" ON "audit_event"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_event_action_at_idx" ON "audit_event"("action", "at");

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules Prisma can't express.
-- ---------------------------------------------------------------------------

ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_request_hash_check"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_expiry_check"
  CHECK ("expires_at" > "created_at");

-- The canonical text an event's hash covers. jsonb prints keys in a fixed
-- order, and the time is in epoch microseconds, so the result doesn't depend
-- on the session's time zone or formatting settings.
CREATE FUNCTION audit_event_payload(e "audit_event") RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'seq', e."seq",
    'id', e."id",
    'actor_id', e."actor_id",
    'session_id', e."session_id",
    'action', e."action",
    'resource_type', e."resource_type",
    'resource_id', e."resource_id",
    'result', e."result",
    'request_id', e."request_id",
    'at_us', (extract(epoch FROM e."at") * 1000000)::BIGINT,
    'metadata', e."metadata"
  )::TEXT;
$$;

CREATE FUNCTION audit_event_hash(prev_hash TEXT, e "audit_event") RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(COALESCE(prev_hash, '') || '|' || audit_event_payload(e), 'UTF8')), 'hex');
$$;

-- Before insert: link the event to the end of the chain. The lock serialises
-- concurrent inserts, and seq is assigned after taking it, so seq order is
-- always chain order. (Assumes READ COMMITTED, the default, so the latest
-- committed event is visible once the lock is held.)
CREATE FUNCTION audit_event_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_event_chain'));
  NEW."seq" := nextval(pg_get_serial_sequence('audit_event', 'seq'));
  SELECT "hash" INTO NEW."prev_hash" FROM "audit_event" ORDER BY "seq" DESC LIMIT 1;
  NEW."hash" := audit_event_hash(NEW."prev_hash", NEW);
  RETURN NEW;
END;
$$;
CREATE TRIGGER "audit_event_link" BEFORE INSERT ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_link();

-- Every stored hash is a real SHA-256 (the "pending" default is always replaced).
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_hash_check" CHECK ("hash" ~ '^[0-9a-f]{64}$');

-- Append-only: no UPDATE, DELETE or TRUNCATE (plan §8).
CREATE FUNCTION audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "audit_event_append_only" BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
CREATE TRIGGER "audit_event_no_truncate" BEFORE TRUNCATE ON "audit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();

-- Recomputes the chain; returns the seq of the first event whose links or
-- hash don't match, or NULL when the whole chain is intact.
CREATE FUNCTION audit_verify_chain() RETURNS BIGINT LANGUAGE plpgsql STABLE AS $$
DECLARE
  e "audit_event";
  expected_prev TEXT := NULL;
BEGIN
  FOR e IN SELECT * FROM "audit_event" ORDER BY "seq" LOOP
    IF e."prev_hash" IS DISTINCT FROM expected_prev
       OR e."hash" <> audit_event_hash(e."prev_hash", e) THEN
      RETURN e."seq";
    END IF;
    expected_prev := e."hash";
  END LOOP;
  RETURN NULL;
END;
$$;
