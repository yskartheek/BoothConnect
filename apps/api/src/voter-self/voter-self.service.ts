import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { notFound } from '../authz/scoped-query';
import type { Scope } from '../authz/scope.service';
import type { Actor } from '../common/actor';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../database/prisma.service';
import {
  type FieldChangeResult,
  FieldValuesService,
  voterLineage,
} from '../field-values/field-values.service';
import type {
  ConsentMethod,
  ConsentStatus,
  Prisma,
  VisitOutcome,
} from '../generated/prisma/client';

/**
 * The details a voter may share and change themselves (#224). Name, age and
 * gender stay as the roll prints them: official corrections go through the
 * Election Commission (Form 8). Restricted fields aren't among them.
 */
export const VOTER_SHAREABLE = ['mobile_number', 'occupation', 'additional_info'] as const;

export interface VoterSharedDetail {
  key: string;
  labelKey: string;
  /** Null when not shared yet. */
  value: Prisma.JsonValue;
  /** Send this as `baseVersion` when changing the detail; null when not shared yet. */
  fieldValueId: string | null;
  collectedAt: Date | null;
}

export interface VoterSelf {
  id: string;
  epicNumber: string | null;
  /** As printed on the roll; never changed here. */
  official: {
    name: string | null;
    relationType: string | null;
    relativeName: string | null;
    age: number | null;
    gender: string | null;
    houseNumber: string | null;
  };
  sectionNo: number | null;
  serialNo: number | null;
  part: { code: string; name: string };
  booth: { code: string; name: string };
  program: { name: string };
  household: { address: string };
  /** The details the voter may share, set or not, in the order above. */
  shared: VoterSharedDetail[];
}

export type VoterUpdate =
  | {
      kind: 'detail';
      fieldKey: string;
      labelKey: string;
      by: 'you' | 'volunteer' | 'admin';
      at: Date;
    }
  | { kind: 'visit'; outcome: VisitOutcome; at: Date }
  | { kind: 'joined'; at: Date };

export interface VoterUpdates {
  items: VoterUpdate[];
}

/** One of the voter's consents (#225). */
export interface VoterConsent {
  id: string;
  /** The field key it covers, e.g. "caste_community". */
  purpose: string;
  /** The covered field's label key, for showing it; null if unknown. */
  labelKey: string | null;
  noticeVersion: string;
  method: ConsentMethod;
  capturedAt: Date;
  status: ConsentStatus;
  withdrawnAt: Date | null;
}

export interface VoterConsents {
  items: VoterConsent[];
}

/** A detail's result: as for any field write, or refused as not shareable. */
export type VoterDetailResult = (
  FieldChangeResult | { status: 'rejected'; code: typeof ErrorCode.FORBIDDEN; message: string }
) & { fieldKey: string };

export interface VoterDetailsEdited {
  /** One result per detail, in request order. */
  fields: VoterDetailResult[];
}

/**
 * A voter's own record (#224), for their session only: the voter comes from
 * the session (`scope.voterId`), never from the request.
 */
@Injectable()
export class VoterSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldValues: FieldValuesService,
    private readonly audit: AuditService,
  ) {}

  async me(scope: Scope, actor: Actor): Promise<VoterSelf> {
    const voterId = await this.currentRecord(scope);
    const voter = await this.prisma.voter.findUniqueOrThrow({
      where: { id: voterId },
      include: {
        part: { select: { code: true, name: true } },
        pollingStation: { select: { code: true, name: true } },
        program: { select: { name: true } },
        household: { select: { displayAddress: true } },
      },
    });
    await this.audit.record({
      action: 'voter.self_view',
      resourceType: 'voter',
      resourceId: voter.id,
      result: 'success',
      actorId: actor.userId,
      sessionId: actor.sessionId ?? null,
      requestId: actor.requestId ?? null,
    });

    const definitions = await this.shareable(voter.programId);
    const values = await this.prisma.fieldValue.findMany({
      where: {
        entityType: 'voter',
        entityId: voter.id,
        isCurrent: true,
        fieldDefinitionId: { in: definitions.map((d) => d.id) },
      },
      orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
    });
    const official = (voter.sourceData ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof official[key] === 'string' ? official[key] : null);
    return {
      id: voter.id,
      epicNumber: voter.sourceVoterId,
      official: {
        name: text('name'),
        relationType: text('relationType'),
        relativeName: text('relativeName'),
        age: typeof official.age === 'number' ? official.age : null,
        gender: text('gender'),
        houseNumber: text('houseNumber'),
      },
      sectionNo: voter.sectionNo,
      serialNo: voter.serialNo,
      part: voter.part,
      booth: voter.pollingStation,
      program: voter.program,
      household: { address: voter.household.displayAddress },
      shared: definitions.map((definition) => {
        // The newest, if a conflict left two.
        const value = values.find((v) => v.fieldDefinitionId === definition.id);
        return {
          key: definition.key,
          labelKey: definition.labelKey,
          value: value?.value ?? null,
          fieldValueId: value?.id ?? null,
          collectedAt: value?.collectedAt ?? null,
        };
      }),
    };
  }

  /**
   * Changes the voter's shared details: each becomes the current value at
   * once, as `voter_self_submitted` (or a conflict, if someone else changed
   * it since `baseVersion`). Anything else is refused per detail.
   */
  async editDetails(
    scope: Scope,
    actor: Actor,
    edits: { fieldKey: string; value: unknown; baseVersion: string | null }[],
  ): Promise<VoterDetailsEdited> {
    const voterId = await this.currentRecord(scope);
    const fields: VoterDetailsEdited['fields'] = [];
    for (const edit of edits) {
      if (!(VOTER_SHAREABLE as readonly string[]).includes(edit.fieldKey)) {
        fields.push({
          fieldKey: edit.fieldKey,
          status: 'rejected',
          code: ErrorCode.FORBIDDEN,
          message: 'This detail can only be changed on the official roll',
        });
        continue;
      }
      const [result] = await this.fieldValues.write(scope, actor.userId, [
        {
          entityType: 'voter',
          entityId: voterId,
          fieldKey: edit.fieldKey,
          value: edit.value as Prisma.InputJsonValue,
          baseVersion: edit.baseVersion,
          sourceType: 'voter_self_submitted',
        },
      ]);
      fields.push({ fieldKey: edit.fieldKey, ...result! });
    }
    await this.audit.record({
      action: 'voter.self_update',
      resourceType: 'voter',
      resourceId: voterId,
      result: 'success',
      actorId: actor.userId,
      sessionId: actor.sessionId ?? null,
      requestId: actor.requestId ?? null,
      // Field keys and outcomes only; never the values.
      metadata: { fields: fields.map((f) => ({ key: f.fieldKey, status: f.status })) },
    });
    return { fields };
  }

  /**
   * What happened to the voter's record, newest first: changes to their
   * details (which detail and who, never the values), visits to their
   * household, and when they joined. Restricted details aren't listed.
   */
  async updates(scope: Scope): Promise<VoterUpdates> {
    const voterId = await this.currentRecord(scope);
    const voter = await this.prisma.voter.findUniqueOrThrow({ where: { id: voterId } });
    const lineage = await voterLineage(this.prisma, voterId);

    const values = await this.prisma.fieldValue.findMany({
      where: {
        entityType: 'voter',
        entityId: { in: lineage },
        // A copy made when a newer roll replaced the record is not a change.
        carriedFromId: null,
        sourceType: { not: 'official_import' },
        fieldDefinition: { isRestricted: false },
      },
      include: { fieldDefinition: { select: { key: true, labelKey: true } } },
      orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const visits = await this.prisma.visit.findMany({
      // The visit as recorded, unless a later visit corrected it.
      where: { householdId: voter.householdId, correctedBy: null },
      select: { outcome: true, startedAt: true },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    const joined = await this.prisma.session.findFirst({
      where: { voterId: { in: lineage } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    const items: VoterUpdate[] = [
      ...values.map((v) => ({
        kind: 'detail' as const,
        fieldKey: v.fieldDefinition.key,
        labelKey: v.fieldDefinition.labelKey,
        by:
          v.sourceType === 'voter_self_submitted'
            ? ('you' as const)
            : v.sourceType === 'admin_corrected'
              ? ('admin' as const)
              : ('volunteer' as const),
        at: v.collectedAt,
      })),
      ...visits.map((v) => ({ kind: 'visit' as const, outcome: v.outcome, at: v.startedAt })),
      ...(joined ? [{ kind: 'joined' as const, at: joined.createdAt }] : []),
    ];
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { items };
  }

  /**
   * The consents the voter gave (on this record or an earlier one), newest
   * first.
   */
  async consents(scope: Scope): Promise<VoterConsents> {
    const voterId = await this.currentRecord(scope);
    const voter = await this.prisma.voter.findUniqueOrThrow({ where: { id: voterId } });
    const rows = await this.prisma.consent.findMany({
      where: { subjectVoterId: { in: await voterLineage(this.prisma, voterId) } },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    });
    const labels = await this.prisma.fieldDefinition.findMany({
      where: { programId: voter.programId, key: { in: rows.map((r) => r.purpose) } },
      select: { key: true, labelKey: true },
    });
    return { items: rows.map((row) => this.consentView(row, labels)) };
  }

  /**
   * Withdraws one of the voter's consents: the values it covers stop being
   * shown and synced at once, and volunteers' phones delete them on their
   * next pull. Withdrawing again changes nothing. Another person's consent
   * is 404.
   */
  async withdrawConsent(scope: Scope, actor: Actor, consentId: string): Promise<VoterConsent> {
    const voterId = await this.currentRecord(scope);
    const lineage = await voterLineage(this.prisma, voterId);
    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.consent.findFirst({
        where: { id: consentId, subjectVoterId: { in: lineage } },
      });
      if (!consent) throw notFound('Consent');
      // Only while still granted: of two withdrawals at once, one changes it
      // and the other finds it withdrawn (the database refuses a second
      // withdrawal of the same record).
      const { count } = await tx.consent.updateMany({
        where: { id: consent.id, status: 'granted' },
        data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawnById: actor.userId },
      });
      const updated = await tx.consent.findUniqueOrThrow({ where: { id: consent.id } });
      if (count === 1) {
        await this.audit.record(
          {
            action: 'consent.withdraw',
            resourceType: 'consent',
            resourceId: consent.id,
            result: 'success',
            actorId: actor.userId,
            sessionId: actor.sessionId ?? null,
            requestId: actor.requestId ?? null,
            metadata: { purpose: consent.purpose, by: 'voter' },
          },
          tx,
        );
      }
      const voter = await tx.voter.findUniqueOrThrow({ where: { id: voterId } });
      const labels = await tx.fieldDefinition.findMany({
        where: { programId: voter.programId, key: consent.purpose },
        select: { key: true, labelKey: true },
      });
      return this.consentView(updated, labels);
    });
  }

  private consentView(
    row: {
      id: string;
      purpose: string;
      noticeVersion: string;
      capturedMethod: ConsentMethod;
      capturedAt: Date;
      status: ConsentStatus;
      withdrawnAt: Date | null;
    },
    labels: { key: string; labelKey: string }[],
  ): VoterConsent {
    return {
      id: row.id,
      purpose: row.purpose,
      labelKey: labels.find((l) => l.key === row.purpose)?.labelKey ?? null,
      noticeVersion: row.noticeVersion,
      method: row.capturedMethod,
      capturedAt: row.capturedAt,
      status: row.status,
      withdrawnAt: row.withdrawnAt,
    };
  }

  /** The detail definitions a voter may share, in VOTER_SHAREABLE order. */
  private async shareable(programId: string) {
    const rows = await this.prisma.fieldDefinition.findMany({
      where: {
        programId,
        appliesTo: 'voter',
        enabled: true,
        isRestricted: false,
        key: { in: [...VOTER_SHAREABLE] },
      },
      select: { id: true, key: true, labelKey: true },
    });
    return VOTER_SHAREABLE.flatMap((key) => rows.filter((r) => r.key === key));
  }

  /**
   * The session's voter, on their current record: a newer roll may have
   * replaced the one they signed in with (#161). 404 when it's no longer on
   * the roll.
   */
  private async currentRecord(scope: Scope): Promise<string> {
    if (!scope.voterId) throw notFound('Voter');
    const rows = await this.prisma.$queryRaw<{ id: string; recordStatus: string }[]>`
      WITH RECURSIVE chain(id, depth) AS (
        SELECT ${scope.voterId}::uuid, 0
        UNION ALL
        SELECT v.id, c.depth + 1 FROM chain c JOIN voter v ON v.previous_voter_id = c.id
         WHERE c.depth < 100
      )
      SELECT v.id, v.record_status AS "recordStatus"
        FROM chain c JOIN voter v ON v.id = c.id
       ORDER BY c.depth DESC LIMIT 1`;
    const current = rows[0];
    if (!current || current.recordStatus !== 'active') throw notFound('Voter');
    return current.id;
  }
}
