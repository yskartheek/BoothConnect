import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import type { GeographyNodeType, MfaState, Role } from '../generated/prisma/client';

export interface NodeSummary {
  id: string;
  type: GeographyNodeType;
  code: string;
  name: string;
}

export interface AssignmentView {
  id: string;
  role: Role;
  validFrom: Date;
  validUntil: Date | null;
  node: NodeSummary & { isAuxiliary: boolean };
  /** From the state down to the assigned node itself, e.g. S29 → PC 6 → AC 40 → part 408 → station 408. */
  path: NodeSummary[];
}

export interface Me {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  preferredLanguage: string;
  mfaState: MfaState;
  assignments: AssignmentView[];
}

const nodeSummary = { id: true, type: true, code: true, name: true } as const;

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<Me> {
    const now = new Date();
    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        preferredLanguage: true,
        mfaState: true,
        roleAssignments: {
          // Active now: started, and not yet ended (the end is exclusive).
          where: {
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          orderBy: { validFrom: 'asc' },
          select: {
            id: true,
            role: true,
            validFrom: true,
            validUntil: true,
            geographyNode: {
              select: {
                ...nodeSummary,
                isAuxiliary: true,
                // The closure table has a row per ancestor (and the node
                // itself at depth 0); deepest first is root first.
                ancestors: {
                  orderBy: { depth: 'desc' },
                  select: { ancestor: { select: nodeSummary } },
                },
              },
            },
          },
        },
      },
    });

    const { roleAssignments, ...profile } = user;
    return {
      ...profile,
      assignments: roleAssignments.map(({ geographyNode, ...assignment }) => {
        const { ancestors, ...node } = geographyNode;
        return { ...assignment, node, path: ancestors.map((row) => row.ancestor) };
      }),
    };
  }
}
