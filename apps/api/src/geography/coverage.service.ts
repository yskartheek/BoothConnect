import { HttpStatus, Injectable } from '@nestjs/common';

import { NodeStatsRefresh } from '../analytics/stats-refresh';
import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { type Coverage, coverageOf } from '../imports/confirm-rules';
import { coverageErrors, covers, mostCommon, overlapErrors } from './coverage';
import { MasterDataService } from './master-data.service';

type Tx = Prisma.TransactionClient;

export interface StationLayout {
  partId: string;
  stations: {
    id: string;
    code: string;
    name: string;
    isAuxiliary: boolean;
    /** Auxiliary stations only; null until set (then it takes no one). */
    coverage: Coverage | null;
    /** Active voters at the station now. */
    voters: number;
  }[];
}

export interface CoverageChange extends StationLayout {
  /** Voters and households that changed station. */
  moved: { voters: number; households: number };
}

const unprocessable = (message: string, details?: unknown) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, message, details);

/**
 * Auxiliary polling stations' coverage (#101; design §2). An auxiliary
 * station takes the voters of its part whose section or serial number it
 * covers; everyone else is at the main station. Changing a coverage moves
 * the voters (and their households) at once, in one transaction, so each
 * voter is always at exactly one station and volunteers' booths follow.
 */
@Injectable()
export class CoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly masterData: MasterDataService,
    private readonly stats: NodeStatsRefresh,
  ) {}

  /** The part's stations with their coverage and voters; `id` is the part or one of its stations. */
  async layout(scope: Scope, id: string): Promise<StationLayout> {
    const node = await this.prisma.geographyNode.findUnique({ where: { id } });
    if (
      !node ||
      (node.type !== 'part' && node.type !== 'polling_station') ||
      !(await this.masterData.adminWithin(scope, node))
    ) {
      throw notFound('Geography node');
    }
    const partId = node.type === 'part' ? node.id : node.parentId!;
    return this.layoutOf(this.prisma, partId);
  }

  /** Sets (or, with null, clears) an auxiliary station's coverage and moves the voters. */
  async setCoverage(
    scope: Scope,
    actor: Actor,
    stationId: string,
    coverage: Coverage | null,
  ): Promise<CoverageChange> {
    const station = await this.prisma.geographyNode.findUnique({ where: { id: stationId } });
    if (
      !station ||
      station.type !== 'polling_station' ||
      !(await this.masterData.adminWithin(scope, station))
    ) {
      throw notFound('Polling station');
    }
    if (!station.isAuxiliary) {
      throw unprocessable(
        'Only an auxiliary station has a coverage; the main station takes everyone else',
      );
    }
    if (coverage) {
      const errors = coverageErrors(coverage);
      if (errors.length > 0) throw unprocessable(errors.join('; '), { errors });
    }
    const partId = station.parentId!;

    return this.prisma.$transaction(async (tx) => {
      // One change per part at a time; an import confirm of the part waits too.
      const stations = await tx.$queryRaw<
        { id: string; code: string; is_auxiliary: boolean; metadata: unknown }[]
      >`
        SELECT id, code, is_auxiliary, metadata FROM geography_node
        WHERE parent_id = ${partId}::uuid AND type = 'polling_station'
        ORDER BY code FOR UPDATE`;
      const others = stations
        .filter((s) => s.is_auxiliary && s.id !== stationId)
        .map((s) => ({ id: s.id, code: s.code, coverage: coverageOf(s.metadata) }))
        .filter((s): s is { id: string; code: string; coverage: Coverage } => s.coverage !== null);
      if (coverage) {
        const errors = overlapErrors(coverage, others);
        if (errors.length > 0) throw unprocessable(errors.join('; '), { errors });
      }
      const covering = [
        ...(coverage ? [{ id: stationId, code: station.code, coverage }] : []),
        ...others,
      ];
      const mains = stations.filter((s) => !s.is_auxiliary);
      const main = mains.find((s) => s.code === station.code.replace(/[A-Za-z]+$/, '')) ?? mains[0];
      if (!main) throw unprocessable('The part has no main station');

      // Where each voter from the roll belongs now.
      const voters = await tx.voter.findMany({
        where: { partId, recordStatus: 'active' },
        select: {
          id: true,
          householdId: true,
          pollingStationId: true,
          sectionNo: true,
          serialNo: true,
        },
      });
      const auxiliary = new Set(stations.filter((s) => s.is_auxiliary).map((s) => s.id));
      const target = new Map<string, string>();
      const both = new Map<string, number>();
      for (const voter of voters) {
        if (voter.sectionNo === null || voter.serialNo === null) continue;
        const hits = covering.filter((c) => covers(c.coverage, voter.sectionNo!, voter.serialNo!));
        if (hits.length > 1) {
          const key = hits.map((h) => h.code).join(' and ');
          both.set(key, (both.get(key) ?? 0) + 1);
        }
        // Not covered: back to the main station (or stays at a main one).
        target.set(
          voter.id,
          hits[0]?.id ?? (auxiliary.has(voter.pollingStationId) ? main.id : voter.pollingStationId),
        );
      }
      if (both.size > 0) {
        const errors = [...both].map(
          ([pair, count]) => `${count} voter${count > 1 ? 's' : ''} would be in both ${pair}`,
        );
        throw unprocessable(errors.join('; '), { errors });
      }

      // Households follow their members from the roll; members added by
      // volunteers follow their household.
      const byHousehold = new Map<string, string[]>();
      for (const voter of voters) {
        const to = target.get(voter.id);
        if (to)
          byHousehold.set(voter.householdId, [...(byHousehold.get(voter.householdId) ?? []), to]);
      }
      const households = await tx.household.findMany({
        where: { id: { in: [...byHousehold.keys()] } },
        select: { id: true, pollingStationId: true },
      });
      const householdTarget = new Map<string, string>();
      for (const household of households) {
        const to = mostCommon(byHousehold.get(household.id)!);
        householdTarget.set(household.id, to);
      }
      for (const voter of voters) {
        if (!target.has(voter.id) && householdTarget.has(voter.householdId)) {
          target.set(voter.id, householdTarget.get(voter.householdId)!);
        }
      }

      const movedVoters = await this.move(
        tx,
        'voter',
        voters.filter((v) => target.has(v.id) && target.get(v.id) !== v.pollingStationId),
        target,
      );
      const movedHouseholds = await this.move(
        tx,
        'household',
        households.filter((h) => householdTarget.get(h.id) !== h.pollingStationId),
        householdTarget,
      );

      // The coverage, and a marker on every station of the part so phones
      // on these booths take a fresh copy at their next sync.
      const changedAt = new Date().toISOString();
      for (const s of stations) {
        const metadata = { ...((s.metadata ?? {}) as Record<string, unknown>) };
        metadata.layoutChangedAt = changedAt;
        if (s.id === stationId) {
          if (coverage) metadata.coverage = normalised(coverage);
          else delete metadata.coverage;
        }
        await tx.geographyNode.update({
          where: { id: s.id },
          data: { metadata: metadata as Prisma.InputJsonValue },
        });
      }
      await this.stats.request([partId], tx);
      await this.audit.record(
        {
          action: 'geography.coverage',
          resourceType: 'geography_node',
          resourceId: stationId,
          result: 'success',
          actorId: actor.userId,
          sessionId: actor.sessionId ?? null,
          requestId: actor.requestId ?? null,
          metadata: {
            partId,
            coverage: coverage ? normalised(coverage) : null,
            movedVoters,
            movedHouseholds,
          },
        },
        tx,
      );
      return {
        ...(await this.layoutOf(tx, partId)),
        moved: { voters: movedVoters, households: movedHouseholds },
      };
    });
  }

  /** Moves rows to their target stations, one update per station. */
  private async move(
    tx: Tx,
    table: 'voter' | 'household',
    rows: { id: string }[],
    target: Map<string, string>,
  ): Promise<number> {
    const byStation = new Map<string, string[]>();
    for (const row of rows) {
      const to = target.get(row.id)!;
      byStation.set(to, [...(byStation.get(to) ?? []), row.id]);
    }
    for (const [pollingStationId, ids] of byStation) {
      const where = { id: { in: ids } };
      if (table === 'voter') await tx.voter.updateMany({ where, data: { pollingStationId } });
      else await tx.household.updateMany({ where, data: { pollingStationId } });
    }
    return rows.length;
  }

  private async layoutOf(db: Tx | PrismaService, partId: string): Promise<StationLayout> {
    const stations = await db.geographyNode.findMany({
      where: { parentId: partId, type: 'polling_station' },
      orderBy: [{ isAuxiliary: 'asc' }, { code: 'asc' }],
    });
    const counts = await db.voter.groupBy({
      by: ['pollingStationId'],
      where: { partId, recordStatus: 'active' },
      _count: { _all: true },
    });
    const count = new Map(counts.map((c) => [c.pollingStationId, c._count._all]));
    return {
      partId,
      stations: stations.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        isAuxiliary: s.isAuxiliary,
        coverage: s.isAuxiliary ? coverageOf(s.metadata) : null,
        voters: count.get(s.id) ?? 0,
      })),
    };
  }
}

/** Sections sorted; only the parts that are set. */
function normalised(coverage: Coverage): Coverage {
  return {
    ...(coverage.sections?.length
      ? { sections: [...coverage.sections].sort((a, b) => a - b) }
      : {}),
    ...(coverage.serials
      ? { serials: { from: coverage.serials.from, to: coverage.serials.to } }
      : {}),
  };
}
