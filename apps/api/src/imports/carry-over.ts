import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

const CHUNK = 1000;

export interface CarryOverCounts {
  /** New records linked to the same voter's previous record (same EPIC). */
  votersLinked: number;
  /** Current field values copied to the new records. */
  valuesCarried: number;
  /** Of those, values still waiting for a volunteer to choose (open conflicts). */
  conflictsCarried: number;
  /** Granted consents on the previous records that now cover the new ones. */
  consentsCarried: number;
}

/**
 * The previous record of each voter in a new revision (#161): the active
 * record from the roll with the same EPIC. An EPIC printed twice in either
 * revision is ambiguous, so it isn't linked.
 */
export function previousRecords(
  previous: { id: string; sourceVoterId: string | null }[],
  epics: (string | null)[],
): Map<string, string> {
  const once = (values: (string | null)[]) => {
    const seen = new Map<string, number>();
    for (const value of values) if (value) seen.set(value, (seen.get(value) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n === 1).map(([value]) => value));
  };
  const unique = once(previous.map((p) => p.sourceVoterId));
  const incoming = once(epics);
  return new Map(
    previous
      .filter(
        (p) => p.sourceVoterId && unique.has(p.sourceVoterId) && incoming.has(p.sourceVoterId),
      )
      .map((p) => [p.sourceVoterId!, p.id]),
  );
}

/**
 * Copies what volunteers recorded on the previous records to the new ones of
 * a revision, inside the commit's transaction (#161). Each current value gets
 * a copy on the new record (same value, collector, time and consent), linked
 * to the value it came from; a consent-gated value only while its consent is
 * granted. An open conflict stays open: both values are copied, still
 * conflicting. Nothing on the previous records changes; consents and visits
 * are found through the link.
 */
export async function carryOver(tx: Tx, sourceVersionId: string): Promise<CarryOverCounts> {
  const links = await tx.voter.findMany({
    where: { sourceVersionId, previousVoterId: { not: null } },
    select: { id: true, previousVoterId: true },
  });
  const newRecordOf = new Map(links.map((l) => [l.previousVoterId!, l.id]));
  const previousIds = [...newRecordOf.keys()];

  const values: {
    id: string;
    entityId: string;
    fieldDefinitionId: string;
    value: Prisma.JsonValue;
    sourceType: Prisma.FieldValueCreateManyInput['sourceType'];
    consentId: string | null;
    collectedById: string | null;
    collectedAt: Date;
    conflictWithId: string | null;
  }[] = [];
  let consentsCarried = 0;
  for (let i = 0; i < previousIds.length; i += CHUNK) {
    const ids = previousIds.slice(i, i + CHUNK);
    const rows = await tx.fieldValue.findMany({
      where: { entityType: 'voter', entityId: { in: ids }, isCurrent: true },
      include: {
        fieldDefinition: { select: { requiresConsent: true } },
        consent: { select: { status: true } },
      },
      // Oldest first, so a conflict's other value is copied before it.
      orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
    });
    values.push(
      // A withdrawn consent is never revived: its values stay behind.
      ...rows.filter((r) => !r.fieldDefinition.requiresConsent || r.consent?.status === 'granted'),
    );
    consentsCarried += await tx.consent.count({
      where: { subjectVoterId: { in: ids }, status: 'granted' },
    });
  }

  // A value in a conflict points at the other value; that one is copied
  // first, so the copy can point at its copy.
  const copyOf = new Map<string, string>();
  const carried = new Set(values.map((v) => v.id));
  let pending = values;
  let conflictsCarried = 0;
  while (pending.length > 0) {
    const ready = pending.filter(
      (v) => !v.conflictWithId || !carried.has(v.conflictWithId) || copyOf.has(v.conflictWithId),
    );
    // A cycle can't happen (a value points at an older one); stop rather than loop.
    if (ready.length === 0) throw new Error('Conflicting values point at each other');
    for (let i = 0; i < ready.length; i += CHUNK) {
      const created = await tx.fieldValue.createManyAndReturn({
        data: ready.slice(i, i + CHUNK).map((v) => ({
          entityType: 'voter' as const,
          entityId: newRecordOf.get(v.entityId)!,
          fieldDefinitionId: v.fieldDefinitionId,
          value: v.value as Prisma.InputJsonValue,
          sourceType: v.sourceType,
          consentId: v.consentId,
          collectedById: v.collectedById,
          collectedAt: v.collectedAt,
          carriedFromId: v.id,
          conflictWithId: v.conflictWithId ? (copyOf.get(v.conflictWithId) ?? null) : null,
        })),
        select: { id: true, carriedFromId: true, conflictWithId: true },
      });
      for (const row of created) {
        copyOf.set(row.carriedFromId!, row.id);
        if (row.conflictWithId) conflictsCarried += 1;
      }
    }
    const done = new Set(ready.map((v) => v.id));
    pending = pending.filter((v) => !done.has(v.id));
  }

  return {
    votersLinked: links.length,
    valuesCarried: copyOf.size,
    conflictsCarried,
    consentsCarried,
  };
}
