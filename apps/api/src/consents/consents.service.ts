import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { PrismaService } from '../database/prisma.service';
import { voterLineage } from '../field-values/field-values.service';
import type { ConsentMethod, ConsentStatus } from '../generated/prisma/enums';

/** One of a voter's consents (#225). */
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

/** A consent as staff see it (#213): also who recorded and who withdrew it. */
export interface StaffConsent extends VoterConsent {
  capturedBy: { id: string; name: string } | null;
  withdrawnBy: { id: string; name: string } | null;
}

export interface StaffConsents {
  items: StaffConsent[];
}

/** Who withdrew a consent, for the audit log: the voter, or staff at their request. */
export type WithdrawnBy = 'voter' | 'volunteer' | 'admin';

const PERSON = { select: { id: true, name: true } } as const;

/**
 * A voter's consents, shared by the voter's own app (#225) and staff
 * (#213). Callers check that the voter is theirs to see; consents are
 * looked up across the voter's earlier records (a newer roll replaced the
 * record).
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Newest first. */
  async list(voterId: string): Promise<StaffConsent[]> {
    const voter = await this.prisma.voter.findUniqueOrThrow({ where: { id: voterId } });
    const rows = await this.prisma.consent.findMany({
      where: { subjectVoterId: { in: await voterLineage(this.prisma, voterId) } },
      include: { capturedBy: PERSON, withdrawnBy: PERSON },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    });
    const labels = await this.labels(
      voter.programId,
      rows.map((r) => r.purpose),
    );
    return rows.map((row) => this.view(row, labels));
  }

  /**
   * Withdraws one of the voter's consents: the values it covers stop being
   * shown and synced at once, and volunteers' phones delete them on their
   * next pull. Withdrawing again changes nothing. A consent that isn't this
   * voter's is 404.
   */
  async withdraw(
    voterId: string,
    consentId: string,
    actor: Actor,
    by: WithdrawnBy,
  ): Promise<StaffConsent> {
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
            metadata: { purpose: consent.purpose, by },
          },
          tx,
        );
      }
      const updated = await tx.consent.findUniqueOrThrow({
        where: { id: consent.id },
        include: { capturedBy: PERSON, withdrawnBy: PERSON },
      });
      const voter = await tx.voter.findUniqueOrThrow({ where: { id: voterId } });
      const labels = await tx.fieldDefinition.findMany({
        where: { programId: voter.programId, key: consent.purpose },
        select: { key: true, labelKey: true },
      });
      return this.view(updated, labels);
    });
  }

  /** What the voter sees of a consent: no staff names. */
  static forVoter(consent: StaffConsent): VoterConsent {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
    const { capturedBy, withdrawnBy, ...own } = consent;
    return own;
  }

  private labels(programId: string, keys: string[]) {
    return this.prisma.fieldDefinition.findMany({
      where: { programId, key: { in: keys } },
      select: { key: true, labelKey: true },
    });
  }

  private view(
    row: {
      id: string;
      purpose: string;
      noticeVersion: string;
      capturedMethod: ConsentMethod;
      capturedAt: Date;
      status: ConsentStatus;
      withdrawnAt: Date | null;
      capturedBy: { id: string; name: string } | null;
      withdrawnBy: { id: string; name: string } | null;
    },
    labels: { key: string; labelKey: string }[],
  ): StaffConsent {
    return {
      id: row.id,
      purpose: row.purpose,
      labelKey: labels.find((l) => l.key === row.purpose)?.labelKey ?? null,
      noticeVersion: row.noticeVersion,
      method: row.capturedMethod,
      capturedAt: row.capturedAt,
      status: row.status,
      withdrawnAt: row.withdrawnAt,
      capturedBy: row.capturedBy,
      withdrawnBy: row.withdrawnBy,
    };
  }
}
