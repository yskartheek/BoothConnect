-- Voter sign-in (#223): a session can act for one voter record. Such a
-- session has the voter role only, and no booths (see ScopeService).
ALTER TABLE "session" ADD COLUMN "voter_id" UUID;

CREATE INDEX "session_voter_id_idx" ON "session"("voter_id");

ALTER TABLE "session" ADD CONSTRAINT "session_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "voter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
