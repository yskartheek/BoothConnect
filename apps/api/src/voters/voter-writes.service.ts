import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { foundInScope, inScope } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { PrismaService } from '../database/prisma.service';
import { type FieldChangeResult, FieldValuesService } from '../field-values/field-values.service';
import type { Prisma } from '../generated/prisma/client';

export interface MemberEdit {
  fieldKey: string;
  value: unknown;
  /** The value ID the phone last saw for this field; null if it saw none. */
  baseVersion: string | null;
  consentId?: string;
}

export interface MemberEdited {
  id: string;
  /** One result per field, in request order. */
  fields: (FieldChangeResult & { fieldKey: string })[];
}

/**
 * Member edits (ADR 0003): each field is written through the field-value
 * service and is the current value at once (or a conflict); the roll's
 * `source_data` is never touched.
 */
@Injectable()
export class VoterWritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldValues: FieldValuesService,
    private readonly audit: AuditService,
  ) {}

  async edit(
    scope: Scope,
    actor: Actor,
    voterId: string,
    edits: MemberEdit[],
    tx?: Prisma.TransactionClient,
  ): Promise<MemberEdited> {
    const run = async (client: Prisma.TransactionClient) => {
      foundInScope(
        await client.voter.findFirst({
          where: { id: voterId, ...inScope(scope) },
          select: { id: true },
        }),
        'Voter',
      );
      const results = await this.fieldValues.write(
        scope,
        actor.userId,
        edits.map((edit) => ({
          entityType: 'voter' as const,
          entityId: voterId,
          fieldKey: edit.fieldKey,
          value: edit.value as Prisma.InputJsonValue,
          baseVersion: edit.baseVersion,
          consentId: edit.consentId,
          // An admin's edit is a correction; a volunteer's is collected in the field.
          sourceType: scope.roles.includes('admin') ? ('admin_corrected' as const) : undefined,
        })),
        client,
      );
      const fields = results.map((result, i) => ({ fieldKey: edits[i]!.fieldKey, ...result }));
      await this.audit.record(
        {
          action: 'voter.update',
          resourceType: 'voter',
          resourceId: voterId,
          result: 'success',
          actorId: actor.userId,
          sessionId: actor.sessionId ?? null,
          requestId: actor.requestId ?? null,
          // Field keys and outcomes only; never the values.
          metadata: { fields: fields.map((f) => ({ key: f.fieldKey, status: f.status })) },
        },
        client,
      );
      return { id: voterId, fields };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }
}
