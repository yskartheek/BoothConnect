import type { PrismaService } from '../src/database/prisma.service';
import { connectDatabase, expectDbError, inRollback, type Tx } from './support/database';
import { createTree, createUser } from './support/fixtures';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('users, sessions and role assignments (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const day = 24 * 60 * 60 * 1000;
  const now = new Date('2026-10-01T06:00:00Z');

  /** The query the auth layer will use: assignments active for a user at time `at`. */
  function activeAssignments(tx: Tx, userId: string, at: Date) {
    return tx.roleAssignment.findMany({
      where: {
        userId,
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
      },
      include: { geographyNode: true },
      orderBy: { validFrom: 'asc' },
    });
  }

  it('returns only the assignments active at a given time', async () => {
    const active = await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      const admin = await createUser(tx, tree.orgId, 'Admin');
      const volunteer = await createUser(tx, tree.orgId, 'Volunteer');
      const grant = (nodeId: string, validFrom: Date, validUntil?: Date) =>
        tx.roleAssignment.create({
          data: {
            userId: volunteer.id,
            role: 'volunteer',
            geographyNodeId: nodeId,
            validFrom,
            validUntil,
            grantedById: admin.id,
          },
        });
      await grant(tree.ps408.id, new Date(now.getTime() - 30 * day), new Date(now.getTime() - day)); // expired
      await grant(tree.ps408a.id, new Date(now.getTime() - 10 * day)); // open-ended
      await grant(tree.ps409.id, new Date(now.getTime() - day), new Date(now.getTime() + day)); // current
      await grant(tree.part409.id, new Date(now.getTime() + day)); // not started yet
      return (await activeAssignments(tx, volunteer.id, now)).map((a) => a.geographyNode.code);
    });
    expect(active).toEqual(['408A', '409']);
  });

  it('uses the (user_id, valid_from) index for that query', async () => {
    const plan = await inRollback(prisma, async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT * FROM role_assignment
          WHERE user_id = '00000000-0000-7000-8000-000000000000'
            AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())`,
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('role_assignment_user_id_valid_from_idx');
  });

  it('rejects a validity window that ends before it starts', async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      const user = await createUser(tx, tree.orgId);
      await expectDbError(
        tx,
        () =>
          tx.roleAssignment.create({
            data: {
              userId: user.id,
              role: 'volunteer',
              geographyNodeId: tree.ps408.id,
              validFrom: now,
              validUntil: new Date(now.getTime() - day),
            },
          }),
        /role_assignment_valid_window_check/,
      );
    });
  });

  it('rejects a role on another organization’s geography, or granted by an outsider', async () => {
    await inRollback(prisma, async (tx) => {
      const ours = await createTree(tx, 'Org A');
      const theirs = await createTree(tx, 'Org B');
      const user = await createUser(tx, ours.orgId);
      const outsider = await createUser(tx, theirs.orgId);
      await expectDbError(
        tx,
        () =>
          tx.roleAssignment.create({
            data: { userId: user.id, role: 'admin', geographyNodeId: theirs.ac.id },
          }),
        /geography node of the user's organization/,
      );
      await expectDbError(
        tx,
        () =>
          tx.roleAssignment.create({
            data: {
              userId: user.id,
              role: 'admin',
              geographyNodeId: ours.ac.id,
              grantedById: outsider.id,
            },
          }),
        /same organization/,
      );
    });
  });

  it('keeps phone numbers and refresh-token hashes unique, and emails lower-case', async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      const user = await createUser(tx, tree.orgId);
      await expectDbError(
        tx,
        () =>
          tx.appUser.create({
            data: { organizationId: tree.orgId, name: 'Dup', phone: user.phone },
          }),
        /Unique constraint/,
      );
      await expectDbError(
        tx,
        () => tx.appUser.update({ where: { id: user.id }, data: { email: 'Admin@Example.org' } }),
        /app_user_email_lowercase_check/,
      );
      const session = {
        userId: user.id,
        deviceId: 'device-1',
        refreshHash: 'a'.repeat(64),
        expiresAt: new Date(now.getTime() + 30 * day),
      };
      await tx.session.create({ data: session });
      await expectDbError(tx, () => tx.session.create({ data: session }), /Unique constraint/);
    });
  });
});
