import type { Prisma } from '../generated/prisma/client';

/**
 * Asks for the analytics of some geography nodes (and their ancestors) to be
 * recomputed. Pass the caller's transaction to queue the request as part of
 * the change that caused it; without one it is picked up right away.
 */
export abstract class NodeStatsRefresh {
  abstract request(nodeIds: string[], tx?: Prisma.TransactionClient): Promise<void>;
}
