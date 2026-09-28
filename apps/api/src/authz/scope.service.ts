import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import type { Role } from '../generated/prisma/client';

/** What the caller may see and do, from their active role assignments. */
export interface Scope {
  userId: string;
  /** Roles held in at least one active assignment. */
  roles: Role[];
  /** The geography nodes of the active assignments (any level). */
  nodeIds: string[];
  /**
   * Every polling station (booth) under any of the caller's assigned nodes,
   * main and auxiliary. Booth-level data is visible only for these IDs.
   */
  boothIds: string[];
}

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the caller's permitted booths: each active assignment (started,
   * not yet ended) covers its node and everything below it, found through
   * `geography_closure` (which includes the node itself at depth 0).
   */
  async resolve(userId: string, at = new Date()): Promise<Scope> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: {
        userId,
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
      },
      select: { role: true, geographyNodeId: true },
    });
    if (assignments.length === 0) return { userId, roles: [], nodeIds: [], boothIds: [] };

    const nodeIds = [...new Set(assignments.map((a) => a.geographyNodeId))];
    const booths = await this.prisma.geographyClosure.findMany({
      where: {
        ancestorId: { in: nodeIds },
        descendant: { type: 'polling_station' },
      },
      select: { descendantId: true },
    });
    return {
      userId,
      roles: [...new Set(assignments.map((a) => a.role))],
      nodeIds,
      boothIds: [...new Set(booths.map((row) => row.descendantId))],
    };
  }
}
