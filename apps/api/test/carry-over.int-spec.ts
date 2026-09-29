import { createHash, randomUUID } from 'node:crypto';

import { ScopeService } from '../src/authz/scope.service';
import { FieldValuesService } from '../src/field-values/field-values.service';
import type { Prisma } from '../src/generated/prisma/client';
import * as carry from '../src/imports/carry-over';
import { ImportConfirmService } from '../src/imports/confirm.service';
import type { BatchView } from '../src/imports/imports.service';
import type { SyncPage } from '../src/sync/sync.service';
import type { VoterDetail } from '../src/voters/voters.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Synthetic data only. Seed part 2 (station 2, volunteer B) has 60 voters
// with EPICs DMO1000061–DMO1000120, serial 1 = DMO1000061 in house 2-3.
const ADMIN = '+919999900001';
const VOLUNTEER_B = '+919999900003';
const epicOf = (serial: number) => `DMO${1_000_060 + serial}`;

describe('carrying volunteer data over to the same voter in a new revision (#161)', () => {
  let t: TestApp;
  let admin: SignedIn;
  let volunteer: SignedIn;
  let confirm: ImportConfirmService;
  let partId: string;
  /** The seed records of serials 1–3, before the new revision. */
  const old: Record<'kept' | 'withdrawn' | 'dropped', string> = {} as never;
  const ids = {} as Record<
    'mobile' | 'occupation' | 'conflict' | 'consentKept' | 'consentWithdrawn' | 'visit' | 'tailor',
    string
  >;

  const write = async (phone: string, changes: Parameters<FieldValuesService['write']>[2]) => {
    const user = await t.prisma.appUser.findUniqueOrThrow({ where: { phone } });
    const scope = await t.app.get(ScopeService).resolve(user.id);
    return t.app.get(FieldValuesService).write(scope, user.id, changes);
  };
  const change = (
    entityId: string,
    fieldKey: string,
    value: Prisma.InputJsonValue,
    baseVersion: string | null,
    consentId?: string,
  ) => ({ entityType: 'voter' as const, entityId, fieldKey, value, baseVersion, consentId });
  const consent = (voterId: string) =>
    t.prisma.consent.create({
      data: {
        subjectVoterId: voterId,
        purpose: 'caste_community',
        noticeVersion: '2026.1',
        capturedMethod: 'in_person_verbal',
      },
    });
  /** Everything stored against the old records, to check nothing changes. */
  const oldState = async () => ({
    voters: await t.prisma.voter.findMany({
      where: { id: { in: Object.values(old) } },
      orderBy: { id: 'asc' },
      select: { id: true, householdId: true, pollingStationId: true, sourceData: true },
    }),
    values: await t.prisma.fieldValue.findMany({
      where: { entityId: { in: Object.values(old) } },
      orderBy: { id: 'asc' },
    }),
    consents: await t.prisma.consent.findMany({
      where: { subjectVoterId: { in: Object.values(old) } },
      orderBy: { id: 'asc' },
    }),
    members: await t.prisma.visitMember.findMany({
      where: { voterId: { in: Object.values(old) } },
      orderBy: { visitId: 'asc' },
    }),
  });

  /** A reviewed file for part 2 with these EPICs (serial n, house of the seed's serial n). */
  const revisionFile = async (epics: string[]) => {
    const part = await t.prisma.geographyNode.findUniqueOrThrow({ where: { id: partId } });
    const batch = (
      await admin.http
        .post('/v1/imports/batches')
        .set('Idempotency-Key', randomUUID())
        .send({ targetNodeId: part.id })
        .expect(201)
    ).body as BatchView;
    const id = randomUUID();
    const counts = { male: epics.length, female: 0, thirdGender: 0, total: epics.length };
    await t.prisma.importFile.create({
      data: {
        id,
        batchId: batch.id,
        programId: part.programId,
        fileRef: `imports/${batch.id}/${id}.pdf`,
        originalName: 'synthetic-part-2.pdf',
        sizeBytes: 1000,
        checksum: createHash('sha256').update(id).digest('hex'),
        status: 'ready',
        pageCount: 3,
        partNodeId: part.id,
        extractionMethod: 'ocr',
        qualityScore: 0.9,
        printedTotals: { startSerial: 1, endSerial: epics.length, counts },
        extractedTotals: counts,
        detectedHeader: {
          header: {
            stateCode: 'S99',
            acNumber: 101,
            partNumber: 2,
            revisionYear: 2027,
            revisionType: 'Synthetic Revision 2027',
            pollingStation: { number: '2', name: 'Synthetic School 2', address: 'Synthetic' },
            auxiliaryStations: [],
          },
          matching: {
            partNodeId: part.id,
            proposedPart: null,
            stations: [{ code: '2', name: 'Synthetic School 2', auxiliary: false, nodeId: null }],
            previousSourceVersionId: null,
          },
          issues: [],
          pageImages: [],
        },
        extractedAt: new Date(),
      },
    });
    await t.prisma.importRowResult.createMany({
      data: epics.map((epic, i) => ({
        importFileId: id,
        page: 3,
        boxIndex: i,
        sectionNo: 1,
        serialNo: i + 1,
        status: 'accepted' as const,
        messages: [],
        rawText: `${i + 1} synthetic`,
        extractedValues: {
          epic,
          name: `Synthetic Person ${i + 1}`,
          relationType: 'father',
          relativeName: `Synthetic Relative ${i + 1}`,
          houseNumber: `2-${(i + 1) * 3}`,
          age: 40,
          gender: 'male',
          printedSerial: i + 1,
          marker: null,
        },
        fieldConfidence: { epic: 0.95 },
      })),
    });
    return id;
  };
  const commit = async (fileId: string) => {
    await admin.http.post(`/v1/imports/files/${fileId}/confirm`).send({}).expect(202);
    await confirm.drain();
    return t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } });
  };
  const newRecordOf = (epic: string, sourceVersionId: string) =>
    t.prisma.voter.findFirstOrThrow({ where: { sourceVoterId: epic, sourceVersionId } });
  const current = (voterId: string) =>
    t.prisma.fieldValue.findMany({
      where: { entityId: voterId, isCurrent: true },
      include: { fieldDefinition: { select: { key: true } } },
      orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
    });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await loginAs(t, ADMIN);
    volunteer = await loginAs(t, VOLUNTEER_B);
    confirm = t.app.get(ImportConfirmService);
    partId = (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'part', code: '2' } }))
      .id;
    for (const [key, serial] of [
      ['kept', 1],
      ['withdrawn', 2],
      ['dropped', 3],
    ] as const) {
      old[key] = (
        await t.prisma.voter.findFirstOrThrow({
          where: { partId, sourceVoterId: epicOf(serial), recordStatus: 'active' },
        })
      ).id;
    }

    // What volunteers recorded on the old records.
    const [mobile, occupation] = await write(VOLUNTEER_B, [
      change(old.kept, 'mobile_number', '+919999900555', null),
      change(old.kept, 'occupation', 'Synthetic weaver', null),
    ]);
    ids.mobile = (mobile as { fieldValueId: string }).fieldValueId;
    ids.occupation = (occupation as { fieldValueId: string }).fieldValueId;
    // An offline edit from a stale base: an open conflict on occupation.
    const [conflict] = await write(VOLUNTEER_B, [
      change(old.kept, 'occupation', 'Synthetic potter', null),
    ]);
    expect(conflict!.status).toBe('conflict');
    ids.conflict = (conflict as { fieldValueId: string }).fieldValueId;
    // Caste with consent (granted), and caste whose consent is then withdrawn.
    ids.consentKept = (await consent(old.kept)).id;
    await write(VOLUNTEER_B, [
      change(old.kept, 'caste_community', 'Synthetic A', null, ids.consentKept),
    ]);
    ids.consentWithdrawn = (await consent(old.withdrawn)).id;
    const [, tailor] = await write(VOLUNTEER_B, [
      change(old.withdrawn, 'caste_community', 'Synthetic B', null, ids.consentWithdrawn),
      change(old.withdrawn, 'occupation', 'Synthetic tailor', null),
    ]);
    // Replaced before the revision: not current, so not carried over.
    ids.tailor = (tailor as { fieldValueId: string }).fieldValueId;
    await write(VOLUNTEER_B, [change(old.withdrawn, 'occupation', 'Synthetic cutter', ids.tailor)]);
    await t.prisma.consent.update({
      where: { id: ids.consentWithdrawn },
      data: { status: 'withdrawn', withdrawnAt: new Date() },
    });
    await write(VOLUNTEER_B, [change(old.dropped, 'occupation', 'Synthetic farmer', null)]);
    // A visit that met voter 1.
    const household = await t.prisma.voter.findUniqueOrThrow({ where: { id: old.kept } });
    ids.visit = (
      (
        await volunteer.http
          .post('/v1/visits')
          .set('Idempotency-Key', randomUUID())
          .send({
            clientId: randomUUID(),
            householdId: household.householdId,
            startedAt: '2026-09-20T10:00:00.000Z',
            outcome: 'completed',
            formVersion: '2026.1',
            memberIdsMet: [old.kept],
          })
          .expect(201)
      ).body as { id: string }
    ).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('a failed commit carries nothing over', async () => {
    const before = await oldState();
    const actual = carry.carryOver;
    const spy = jest.spyOn(carry, 'carryOver').mockImplementationOnce(async (tx, versionId) => {
      await actual(tx, versionId);
      throw new Error('Synthetic failure after carrying over');
    });
    try {
      const file = await commit(await revisionFile([epicOf(1), epicOf(2), 'TST9000001']));
      expect(file.status).toBe('needs_review');
    } finally {
      spy.mockRestore();
    }
    expect(await t.prisma.fieldValue.count({ where: { carriedFromId: { not: null } } })).toBe(0);
    expect(await t.prisma.voter.count({ where: { previousVoterId: { not: null } } })).toBe(0);
    expect(await t.prisma.voter.count({ where: { id: old.kept, recordStatus: 'active' } })).toBe(1);
    expect(await oldState()).toEqual(before);
  });

  describe('after a new revision is committed', () => {
    let versionId: string;
    let before: Awaited<ReturnType<typeof oldState>>;
    const records: Record<string, string> = {};

    beforeAll(async () => {
      before = await oldState();
      // Voters 1 and 2 are in it (same EPIC); voter 3 isn't; one voter is new.
      const file = await commit(await revisionFile([epicOf(1), epicOf(2), 'TST9000002']));
      expect(file.status).toBe('confirmed');
      versionId = file.sourceVersionId!;
      records.kept = (await newRecordOf(epicOf(1), versionId)).id;
      records.withdrawn = (await newRecordOf(epicOf(2), versionId)).id;
      records.fresh = (await newRecordOf('TST9000002', versionId)).id;
    });

    it('links each new record to the same voter’s previous record', async () => {
      const linked = await t.prisma.voter.findMany({
        where: { sourceVersionId: versionId },
        orderBy: { serialNo: 'asc' },
      });
      expect(linked.map((v) => v.previousVoterId)).toEqual([old.kept, old.withdrawn, null]);
    });

    it('keeps current field values, with collector, time and consent, and the open conflict', async () => {
      const oldValues = new Map((await current(old.kept)).map((v) => [v.id, v]));
      const values = await current(records.kept!);
      expect(values.map((v) => [v.fieldDefinition.key, v.value])).toEqual([
        ['mobile_number', '+919999900555'],
        ['occupation', 'Synthetic weaver'],
        ['occupation', 'Synthetic potter'],
        ['caste_community', 'Synthetic A'],
      ]);
      for (const value of values) {
        const from = oldValues.get(value.carriedFromId!)!;
        expect(value).toMatchObject({
          value: from.value,
          sourceType: from.sourceType,
          collectedById: from.collectedById,
          collectedAt: from.collectedAt,
          consentId: from.consentId,
          supersedesId: null,
        });
      }
      // The conflict is still open, between the two copies.
      const [weaver, potter] = [values[1]!, values[2]!];
      expect(potter.carriedFromId).toBe(ids.conflict);
      expect(potter.conflictWithId).toBe(weaver.id);
      expect(values[3]!.consentId).toBe(ids.consentKept);
    });

    it('a withdrawn consent is not revived and its values stay behind; a new EPIC starts empty', async () => {
      expect(
        (await current(records.withdrawn!)).map((v) => [v.fieldDefinition.key, v.value]),
      ).toEqual([['occupation', 'Synthetic cutter']]);
      expect(await current(records.fresh!)).toEqual([]);
    });

    it('nothing on the superseded records changes', async () => {
      expect(await oldState()).toEqual(before);
    });

    it('is audited with counts only', async () => {
      const event = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'import.file.committed', result: 'success' },
        orderBy: { seq: 'desc' },
      });
      expect(event.metadata).toMatchObject({
        sourceVersionId: versionId,
        carriedOver: { votersLinked: 2, valuesCarried: 5, conflictsCarried: 1, consentsCarried: 1 },
      });
    });

    it('the voter view shows the carried values, the earlier record and the visit', async () => {
      const detail = (await volunteer.http.get(`/v1/voters/${records.kept}`).expect(200))
        .body as VoterDetail;
      expect(detail.previousVoterIds).toEqual([old.kept]);
      expect(detail.visitsMet.map((v) => [v.id, v.outcome])).toEqual([[ids.visit, 'completed']]);
      const caste = detail.fields.find((f) => f.key === 'caste_community')!;
      expect(caste.current.map((v) => v.value)).toEqual(['Synthetic A']);
      const occupation = detail.fields.find((f) => f.key === 'occupation')!;
      expect(occupation.current).toHaveLength(2);
      const fresh = (await volunteer.http.get(`/v1/voters/${records.fresh}`).expect(200))
        .body as VoterDetail;
      expect(fresh).toMatchObject({ previousVoterIds: [], visitsMet: [] });
    });

    it('sync sends the new record with its values; conflicts only on the new record', async () => {
      const pages: SyncPage[] = [];
      let cursor: string | undefined;
      do {
        const page = (
          await volunteer.http
            .get(`/v1/sync/pull${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`)
            .expect(200)
        ).body as SyncPage;
        pages.push(page);
        cursor = page.cursor;
      } while (pages.at(-1)!.hasMore);
      const voters = pages.flatMap((p) => p.voters);
      expect(voters.find((v) => v.id === records.kept)).toMatchObject({
        previousVoterIds: [old.kept],
        recordStatus: 'active',
      });
      expect(voters.some((v) => v.id === old.kept)).toBe(false);
      const values = pages.flatMap((p) => p.fieldValues);
      expect(values.filter((v) => v.entityId === records.kept)).toHaveLength(4);
      expect(values.some((v) => v.entityId === old.kept)).toBe(false);
      expect(
        values.find((v) => v.entityId === records.kept && v.carriedFromId === ids.mobile),
      ).toBeDefined();
      const conflicts = pages.at(-1)!.conflicts;
      expect(conflicts.map((c) => c.entityId)).toEqual([records.kept]);
      // The visit still lists the record it met, which the phone finds
      // through previousVoterIds.
      const visit = pages.flatMap((p) => p.visits).find((v) => v.id === ids.visit)!;
      expect(visit.memberIdsMet).toEqual([old.kept]);
    });

    it('an offline edit to the old record lands on the new one; its consent still counts', async () => {
      const copy = await t.prisma.fieldValue.findUniqueOrThrow({
        where: { carriedFromId: ids.mobile },
      });
      const [edit] = await write(VOLUNTEER_B, [
        change(old.kept, 'mobile_number', '+919999900556', ids.mobile),
      ]);
      expect(edit).toMatchObject({
        status: 'applied',
        entityId: records.kept,
        supersedesId: copy.id,
      });
      // A base that wasn't current when the revision came is stale: a conflict.
      const cutter = await t.prisma.fieldValue.findFirstOrThrow({
        where: { entityId: records.withdrawn, isCurrent: true },
      });
      const [stale] = await write(VOLUNTEER_B, [
        change(old.withdrawn, 'occupation', 'Synthetic tailor again', ids.tailor),
      ]);
      expect(stale).toMatchObject({
        status: 'conflict',
        entityId: records.withdrawn,
        conflictWithId: cutter.id,
      });
      // Not a value of the field at all: rejected, as for any record.
      const [unknown] = await write(VOLUNTEER_B, [
        change(old.kept, 'mobile_number', '+919999900557', randomUUID()),
      ]);
      expect(unknown).toMatchObject({ status: 'rejected', code: 'BASE_VERSION_INVALID' });
      const [caste] = await write(VOLUNTEER_B, [
        change(
          records.kept!,
          'caste_community',
          'Synthetic A2',
          (
            await t.prisma.fieldValue.findFirstOrThrow({
              where: { entityId: records.kept, isCurrent: true, consentId: ids.consentKept },
            })
          ).id,
          ids.consentKept,
        ),
      ]);
      expect(caste).toMatchObject({ status: 'applied', entityId: records.kept });
      // A withdrawn consent covers nothing, on any record.
      const [refused] = await write(VOLUNTEER_B, [
        change(records.withdrawn!, 'caste_community', 'Synthetic B2', null, ids.consentWithdrawn),
      ]);
      expect(refused).toMatchObject({ status: 'rejected', code: 'CONSENT_REQUIRED' });
      expect(await oldState()).toEqual(before);
    });

    it('resolving the conflict by its old IDs resolves the carried one', async () => {
      const res = await volunteer.http
        .post(`/v1/conflicts/${ids.conflict}/resolve`)
        .send({ keepFieldValueId: ids.conflict })
        .expect(200);
      const potterCopy = await t.prisma.fieldValue.findUniqueOrThrow({
        where: { carriedFromId: ids.conflict },
      });
      expect(res.body).toMatchObject({ keptId: potterCopy.id });
      expect(
        (await current(records.kept!))
          .filter((v) => v.fieldDefinition.key === 'occupation')
          .map((v) => [v.value, v.conflictWithId]),
      ).toEqual([['Synthetic potter', null]]);
      expect(await oldState()).toEqual(before);
    });
  });
});
