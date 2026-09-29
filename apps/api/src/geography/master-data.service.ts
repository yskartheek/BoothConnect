import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  type ExistingNode,
  type MasterLevel,
  type PlannedRow,
  planMasterData,
  readMasterCsv,
} from './master-data';

type Tx = Prisma.TransactionClient;

export interface MasterImportReport {
  programId: string;
  /** False for a preview; true once the rows have been saved. */
  applied: boolean;
  counts: Record<'create' | 'update' | 'unchanged' | 'error', number>;
  rows: {
    line: number;
    level: string;
    code: string;
    name: string;
    parentCode: string | null;
    action: PlannedRow['action'];
    errors: string[];
  }[];
}

export interface MasterNodeView {
  id: string;
  parentId: string | null;
  type: MasterLevel | 'part' | 'polling_station';
  code: string;
  name: string;
  reservation: string | null;
}

const PARENT_OF: Record<MasterLevel, MasterLevel | null> = { state: null, pc: 'state', ac: 'pc' };

const unprocessable = (message: string, details?: unknown) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, message, details);

/**
 * Geography master data (#100; design §2, §10): the State → PC → AC list,
 * uploaded as a CSV (previewed, then confirmed) or fixed one node at a time.
 * Nodes are created or renamed, never deleted. Admins change only their own
 * area; an admin of a State manages the program's whole list (they can add
 * States, and then must be able to fix them). Parts and polling stations
 * come from roll imports, not from here.
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importCsv(
    scope: Scope,
    actor: Actor,
    csv: string,
    confirm: boolean,
    programId?: string,
  ): Promise<MasterImportReport> {
    const access = await this.access(scope, programId);
    let rows;
    try {
      rows = readMasterCsv(csv);
    } catch (error) {
      throw unprocessable((error as Error).message);
    }
    const existing = await this.existing(this.prisma, access.programId);
    const plan = planMasterData(rows, {
      existing,
      canEdit: (id) => access.within.has(id),
      canAddUnder: (id) => access.within.has(id),
      canAddState: access.canAddState,
    });
    const report = toReport(access.programId, plan, false);
    if (!confirm) return report;
    if (report.counts.error > 0) {
      throw unprocessable('Some rows have errors; nothing was saved', report);
    }

    await this.prisma.$transaction(async (tx) => {
      // Parents first: a row's parent is either existing or created above it.
      const ids = new Map(existing.map((n) => [n.key, n.id]));
      for (const level of ['state', 'pc', 'ac'] as const) {
        for (const row of plan.filter((r) => r.level === level)) {
          if (row.action === 'create') {
            const node = await tx.geographyNode.create({
              data: {
                programId: access.programId,
                parentId: row.parentKey ? ids.get(row.parentKey)! : null,
                type: level,
                code: row.code,
                name: row.name,
                metadata: row.reservation ? { reservation: row.reservation } : {},
              },
            });
            ids.set(row.key!, node.id);
          } else if (row.action === 'update') {
            await this.rename(tx, row.nodeId!, row.name, row.reservation);
          }
        }
      }
      await this.audit.record(
        {
          action: 'geography.import',
          resourceType: 'election_program',
          resourceId: access.programId,
          result: 'success',
          actorId: actor.userId,
          sessionId: actor.sessionId ?? null,
          requestId: actor.requestId ?? null,
          metadata: {
            created: report.counts.create,
            updated: report.counts.update,
            unchanged: report.counts.unchanged,
          },
        },
        tx,
      );
    });
    return { ...report, applied: true };
  }

  /** Adds one State, PC or AC. */
  async create(
    scope: Scope,
    actor: Actor,
    dto: { type: MasterLevel; code: string; name: string; reservation?: string; parentId?: string },
  ): Promise<MasterNodeView> {
    const parentType = PARENT_OF[dto.type];
    let programId: string;
    if (parentType === null) {
      if (dto.parentId) throw unprocessable('A State has no parent');
      const access = await this.access(scope);
      if (!access.canAddState) throw notFound('Geography node');
      programId = access.programId;
    } else {
      if (!dto.parentId) throw unprocessable(`A ${dto.type.toUpperCase()} needs its parent`);
      const parent = await this.prisma.geographyNode.findUnique({ where: { id: dto.parentId } });
      if (!parent || !(await this.adminWithin(scope, parent))) throw notFound('Geography node');
      if (parent.type !== parentType) {
        throw unprocessable(`A ${dto.type.toUpperCase()} goes under a ${parentType.toUpperCase()}`);
      }
      programId = parent.programId;
    }
    const node = await this.prisma.$transaction(async (tx) => {
      const created = await tx.geographyNode.create({
        data: {
          programId,
          parentId: dto.parentId ?? null,
          type: dto.type,
          code: dto.code,
          name: dto.name,
          metadata: dto.reservation ? { reservation: dto.reservation } : {},
        },
      });
      await this.audit.record(
        {
          action: 'geography.create',
          resourceType: 'geography_node',
          resourceId: created.id,
          result: 'success',
          actorId: actor.userId,
          sessionId: actor.sessionId ?? null,
          requestId: actor.requestId ?? null,
          metadata: { type: dto.type, parentId: dto.parentId ?? null },
        },
        tx,
      );
      return created;
    });
    return view(node);
  }

  /** Renames a node or changes its reservation; code, type and parent never change. */
  async update(
    scope: Scope,
    actor: Actor,
    id: string,
    dto: { name?: string; reservation?: string | null },
  ): Promise<MasterNodeView> {
    if (dto.name === undefined && dto.reservation === undefined) {
      throw unprocessable('Give a name or a reservation');
    }
    const node = await this.prisma.geographyNode.findUnique({ where: { id } });
    if (!node || !(await this.adminWithin(scope, node))) throw notFound('Geography node');
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await this.rename(
        tx,
        id,
        dto.name ?? node.name,
        dto.reservation === undefined ? reservationOf(node.metadata) : dto.reservation,
      );
      await this.audit.record(
        {
          action: 'geography.update',
          resourceType: 'geography_node',
          resourceId: id,
          result: 'success',
          actorId: actor.userId,
          sessionId: actor.sessionId ?? null,
          requestId: actor.requestId ?? null,
          metadata: {
            fields: [
              ...(dto.name !== undefined ? ['name'] : []),
              ...(dto.reservation !== undefined ? ['reservation'] : []),
            ],
          },
        },
        tx,
      );
      return saved;
    });
    return view(updated);
  }

  private async rename(tx: Tx, id: string, name: string, reservation: string | null) {
    const node = await tx.geographyNode.findUniqueOrThrow({ where: { id } });
    const metadata = { ...((node.metadata ?? {}) as Record<string, unknown>) };
    if (reservation === null) delete metadata.reservation;
    else metadata.reservation = reservation;
    return tx.geographyNode.update({
      where: { id },
      data: { name, metadata: metadata as Prisma.InputJsonValue },
    });
  }

  /**
   * What the caller may change: nodes at or below their admin assignments,
   * or the whole program (new States included) when they are an admin of a
   * State. Their program, from those assignments (or `programId` when they
   * have several).
   */
  private async access(scope: Scope, programId?: string) {
    const assignments = await this.adminAssignments(scope.userId);
    const programs = [...new Set(assignments.map((a) => a.geographyNode.programId))];
    const chosen = programId ?? (programs.length === 1 ? programs[0] : undefined);
    if (!chosen) {
      throw unprocessable('You are an admin in several programs; say which with programId');
    }
    if (!programs.includes(chosen)) throw notFound('Program');
    const mine = assignments.filter((a) => a.geographyNode.programId === chosen);
    const canAddState = mine.some((a) => a.geographyNode.type === 'state');
    const within = canAddState
      ? await this.prisma.geographyNode.findMany({
          where: { programId: chosen },
          select: { id: true },
        })
      : (
          await this.prisma.geographyClosure.findMany({
            where: { ancestorId: { in: mine.map((a) => a.geographyNodeId) } },
            select: { descendantId: true },
          })
        ).map((b) => ({ id: b.descendantId }));
    return { programId: chosen, within: new Set(within.map((n) => n.id)), canAddState };
  }

  private async adminWithin(
    scope: Scope,
    node: { id: string; programId: string },
  ): Promise<boolean> {
    const assignments = await this.adminAssignments(scope.userId);
    if (
      assignments.some(
        (a) => a.geographyNode.type === 'state' && a.geographyNode.programId === node.programId,
      )
    ) {
      return true;
    }
    if (assignments.length === 0) return false;
    const nodeId = node.id;
    const found = await this.prisma.geographyClosure.findFirst({
      where: {
        descendantId: nodeId,
        ancestorId: { in: assignments.map((a) => a.geographyNodeId) },
      },
      select: { ancestorId: true },
    });
    return found !== null;
  }

  private adminAssignments(userId: string) {
    const now = new Date();
    return this.prisma.roleAssignment.findMany({
      where: {
        userId,
        role: 'admin',
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      include: { geographyNode: { select: { programId: true, type: true } } },
    });
  }

  /** The program's States, PCs and ACs, keyed by their path of codes. */
  private async existing(db: Tx | PrismaService, programId: string): Promise<ExistingNode[]> {
    const rows = await db.$queryRaw<
      {
        id: string;
        type: MasterLevel;
        code: string;
        name: string;
        metadata: unknown;
        key: string;
      }[]
    >`
      SELECT n.id, n.type::text AS type, n.code, n.name, n.metadata,
        (SELECT string_agg(a.code, '/' ORDER BY c.depth DESC)
         FROM geography_closure c JOIN geography_node a ON a.id = c.ancestor_id
         WHERE c.descendant_id = n.id) AS key
      FROM geography_node n
      WHERE n.program_id = ${programId}::uuid AND n.type IN ('state', 'pc', 'ac')`;
    return rows.map((r) => ({
      id: r.id,
      level: r.type,
      code: r.code,
      name: r.name,
      reservation: reservationOf(r.metadata),
      key: r.key,
    }));
  }
}

function reservationOf(metadata: unknown): string | null {
  const value = (metadata as { reservation?: unknown } | null)?.reservation;
  return typeof value === 'string' ? value : null;
}

function view(node: {
  id: string;
  parentId: string | null;
  type: string;
  code: string;
  name: string;
  metadata: unknown;
}): MasterNodeView {
  return {
    id: node.id,
    parentId: node.parentId,
    type: node.type as MasterNodeView['type'],
    code: node.code,
    name: node.name,
    reservation: reservationOf(node.metadata),
  };
}

function toReport(programId: string, plan: PlannedRow[], applied: boolean): MasterImportReport {
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const row of plan) counts[row.action] += 1;
  return {
    programId,
    applied,
    counts,
    rows: plan.map(({ line, level, code, name, parentCode, action, errors }) => ({
      line,
      level,
      code,
      name,
      parentCode,
      action,
      errors,
    })),
  };
}
