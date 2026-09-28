import { mapPrismaError } from '../src/common/errors/prisma-errors';
import type { PrismaService } from '../src/database/prisma.service';
import { connectDatabase, inRollback } from './support/database';
import { createProgram, createUser } from './support/fixtures';

// Real Prisma errors through the pg driver adapter, whose error metadata
// differs from Prisma's own engine: the mapping must still find the fields.
describe('mapPrismaError with real database errors', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function caught(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      await fn();
    } catch (error) {
      return error;
    }
    throw new Error('expected an error');
  }

  it('maps a unique violation to 409 UNIQUE_VIOLATION naming the constraint', async () => {
    await inRollback(prisma, async (tx) => {
      const { orgId } = await createProgram(tx);
      const user = await createUser(tx, orgId);
      await tx.$executeRawUnsafe('SAVEPOINT dup');
      const error = await caught(() =>
        tx.appUser.create({ data: { organizationId: orgId, name: 'Copy', phone: user.phone } }),
      );
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT dup');

      const mapped = mapPrismaError(error);
      expect(mapped?.getStatus()).toBe(409);
      expect(mapped?.code).toBe('UNIQUE_VIOLATION');
      // The pg adapter reports the index, not the columns.
      expect(mapped?.details).toEqual({ constraint: 'app_user_phone_key' });
    });
  });

  it('maps a missing record to 404 NOT_FOUND', async () => {
    const error = await caught(() =>
      prisma.appUser.update({
        where: { id: '00000000-0000-7000-8000-000000000000' },
        data: { name: 'x' },
      }),
    );
    expect(mapPrismaError(error)).toMatchObject({ code: 'NOT_FOUND' });
    expect(mapPrismaError(error)?.getStatus()).toBe(404);
  });

  it('maps a foreign-key violation to 409 FOREIGN_KEY_VIOLATION', async () => {
    const error = await caught(() =>
      prisma.appUser.create({
        data: {
          organizationId: '00000000-0000-7000-8000-000000000000',
          name: 'Orphan',
          phone: '+919000099999',
        },
      }),
    );
    expect(mapPrismaError(error)).toMatchObject({ code: 'FOREIGN_KEY_VIOLATION' });
  });

  it('leaves other errors to the 500 handler', () => {
    expect(mapPrismaError(new Error('boom'))).toBeUndefined();
  });
});
