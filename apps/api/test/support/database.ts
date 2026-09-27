import { Test } from '@nestjs/testing';

import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/prisma.service';
import type { Prisma } from '../../src/generated/prisma/client';

export type Tx = Prisma.TransactionClient;

/** A PrismaService connected to the real database (integration tests only). */
export async function connectDatabase(): Promise<PrismaService> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, DatabaseModule],
  }).compile();
  return moduleRef.get(PrismaService);
}

class Rollback extends Error {}

/**
 * Runs `fn` in a transaction that is always rolled back, so tests leave no
 * data behind. The callback's result is returned.
 */
export async function inRollback<T>(prisma: PrismaService, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result as T;
}

/** Expects `fn` to fail inside its own savepoint, so the outer transaction stays usable. */
export async function expectDbError(
  tx: Tx,
  fn: () => Promise<unknown>,
  message: RegExp,
): Promise<void> {
  await tx.$executeRawUnsafe('SAVEPOINT expect_error');
  await expect(fn()).rejects.toThrow(message);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expect_error');
}
