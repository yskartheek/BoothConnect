import { createHash } from 'node:crypto';

import type { PrismaService } from '../src/database/prisma.service';
import { connectDatabase, expectDbError, inRollback, type Tx } from './support/database';
import { createTree, createUser } from './support/fixtures';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
// Everything runs in rolled-back transactions: the audit log is append-only, so
// committed test events could never be cleaned up.
describe('audit log and idempotency records (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function logEvents(tx: Tx, count: number) {
    const tree = await createTree(tx);
    const actor = await createUser(tx, tree.orgId, 'Admin');
    const events = [];
    for (let i = 0; i < count; i += 1) {
      events.push(
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: 'visit.create',
            resourceType: 'visit',
            resourceId: `visit-${i}`,
            result: 'success',
            requestId: `req-${i}`,
            metadata: { outcome: 'completed' },
          },
        }),
      );
    }
    return events;
  }

  const verify = async (tx: Tx) =>
    (await tx.$queryRaw<{ broken: bigint | null }[]>`SELECT audit_verify_chain() AS broken`)[0]
      ?.broken;

  it('links every event to the previous one and verifies the chain', async () => {
    await inRollback(prisma, async (tx) => {
      const before = await tx.auditEvent.findFirst({ orderBy: { seq: 'desc' } });
      const events = await logEvents(tx, 3);
      expect(events[0]?.prevHash).toBe(before?.hash ?? null);
      expect(events[1]?.prevHash).toBe(events[0]?.hash);
      expect(events[2]?.prevHash).toBe(events[1]?.hash);
      expect(events.every((e) => /^[0-9a-f]{64}$/.test(e.hash))).toBe(true);
      expect(events[1]!.seq > events[0]!.seq).toBe(true);
      expect(await verify(tx)).toBeNull();
    });
  });

  it('refuses UPDATE, DELETE and TRUNCATE on audit_event', async () => {
    await inRollback(prisma, async (tx) => {
      const [event] = await logEvents(tx, 1);
      await expectDbError(
        tx,
        () => tx.auditEvent.update({ where: { id: event!.id }, data: { result: 'failure' } }),
        /append-only/,
      );
      await expectDbError(
        tx,
        () => tx.auditEvent.delete({ where: { id: event!.id } }),
        /append-only/,
      );
      await expectDbError(tx, () => tx.$executeRawUnsafe('TRUNCATE audit_event'), /append-only/);
    });
  });

  it('detects a tampered event', async () => {
    await inRollback(prisma, async (tx) => {
      const events = await logEvents(tx, 3);
      // Simulate someone with database access bypassing the trigger.
      await tx.$executeRawUnsafe('ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only');
      await tx.$executeRaw`UPDATE audit_event SET metadata = '{"outcome":"refused"}' WHERE id = ${events[1]!.id}::uuid`;
      expect(await verify(tx)).toBe(events[1]!.seq);
    });
  });

  it('keeps one idempotency record per user and key, with a valid hash and expiry', async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      const user = await createUser(tx, tree.orgId, 'Volunteer');
      const record = {
        userId: user.id,
        key: 'b6f1c0de-0000-4000-8000-000000000001',
        requestHash: createHash('sha256').update('POST /v1/visits {}').digest('hex'),
        statusCode: 201,
        response: { id: 'visit-1' },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      await tx.idempotencyRecord.create({ data: record });
      await expectDbError(
        tx,
        () => tx.idempotencyRecord.create({ data: record }),
        /Unique constraint/,
      );
      const other = await createUser(tx, tree.orgId, 'Other volunteer');
      await tx.idempotencyRecord.create({ data: { ...record, userId: other.id } });
      await expectDbError(
        tx,
        () => tx.idempotencyRecord.create({ data: { ...record, key: 'k2', requestHash: 'nope' } }),
        /idempotency_record_request_hash_check/,
      );
      await expectDbError(
        tx,
        () =>
          tx.idempotencyRecord.create({
            data: { ...record, key: 'k3', expiresAt: new Date('2000-01-01') },
          }),
        /idempotency_record_expiry_check/,
      );
    });
  });
});
