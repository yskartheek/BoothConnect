import { createHash, randomUUID } from 'node:crypto';

import type { CoverageChange, StationLayout } from '../src/geography/coverage.service';
import type { MasterNodeView } from '../src/geography/master-data.service';
import { ImportConfirmService } from '../src/imports/confirm.service';
import type { BatchView } from '../src/imports/imports.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Synthetic data only. Seed part 1 has main station 1 and auxiliary 1A
// (covering section 2, serials 31–60); the admin is an admin of AC 101.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

describe('adding an auxiliary polling station by hand (#172)', () => {
  let t: TestApp;
  let admin: SignedIn;
  const ids = {} as Record<'part1' | 'part2' | 'ac101' | 'station1b', string>;

  const add = (body: object, status: number, who = admin) =>
    who.http
      .post('/v1/geographies')
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'polling_station', ...body })
      .expect(status)
      .then((res) => res.body as MasterNodeView & { message?: string });
  const station = (code: string, extra: object = {}) => ({
    code,
    name: `Synthetic School Room ${code}`,
    parentId: ids.part1,
    isAuxiliary: true,
    address: 'Synthetic School, Demo Nagar',
    ...extra,
  });
  const coverage = (id: string, value: object, status: number) =>
    admin.http
      .put(`/v1/geographies/${id}/coverage`)
      .set('Idempotency-Key', randomUUID())
      .send({ coverage: value })
      .expect(status)
      .then((res) => res.body as CoverageChange & { message?: string });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await loginAs(t, ADMIN);
    const node = async (type: 'part' | 'ac', code: string) =>
      (await t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } })).id;
    ids.part1 = await node('part', '1');
    ids.part2 = await node('part', '2');
    ids.ac101 = await node('ac', '101');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('adds 1B under part 1; it takes voters once its coverage is set', async () => {
    const added = await add(station('1B', { stationType: 'female' }), 201);
    ids.station1b = added.id;
    expect(added).toEqual({
      id: added.id,
      parentId: ids.part1,
      type: 'polling_station',
      code: '1B',
      name: 'Synthetic School Room 1B',
      reservation: null,
      isAuxiliary: true,
    });
    const node = await t.prisma.geographyNode.findUniqueOrThrow({ where: { id: added.id } });
    expect(node.metadata).toEqual({
      address: 'Synthetic School, Demo Nagar',
      stationType: 'female',
    });
    // Below the part in the closure: the part's admins and analytics see it.
    expect(
      await t.prisma.geographyClosure.count({
        where: { descendantId: added.id, ancestorId: ids.ac101 },
      }),
    ).toBe(1);
    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'geography.create', resourceId: added.id },
    });
    expect(audit).toMatchObject({
      actorId: admin.userId,
      metadata: { type: 'polling_station', parentId: ids.part1, isAuxiliary: true },
    });

    const layout = (await admin.http.get(`/v1/geographies/${ids.part1}/stations`).expect(200))
      .body as StationLayout;
    expect(layout.stations.map((s) => [s.code, s.isAuxiliary, s.coverage, s.voters])).toEqual([
      ['1', false, null, 31],
      ['1A', true, { sections: [2] }, 30],
      ['1B', true, null, 0],
    ]);
    // Two auxiliary stations can't cover the same voters.
    const overlap = await coverage(added.id, { sections: [2] }, 422);
    expect(overlap.message).toBe('Section 2 already covered by 1A');
    const moved = await coverage(added.id, { serials: { from: 1, to: 6 } }, 200);
    expect(moved.stations.find((s) => s.code === '1B')!.voters).toBeGreaterThanOrEqual(6);
  });

  it('only an auxiliary station, under a part, with an address and a new code', async () => {
    const main = await add(station('1C', { isAuxiliary: undefined }), 422);
    expect(main.message).toBe(
      'Only an auxiliary station can be added by hand; the main station comes from the roll',
    );
    await add(station('1C', { isAuxiliary: false }), 422);
    expect((await add(station('1C', { address: undefined }), 422)).message).toBe(
      'An auxiliary station needs its address',
    );
    expect((await add(station('1C', { parentId: ids.ac101 }), 422)).message).toBe(
      'A polling station goes under a part',
    );
    await add(station('1C', { parentId: undefined }), 422);
    await add(station('1C', { reservation: 'SC' }), 422);
    await add(station('1C', { stationType: 'mixed' }), 400);
    const taken = await add(station('1A'), 409);
    expect(taken.message).toBe('Part 1 already has a station 1A');
    await add(station('1C', { parentId: randomUUID() }), 404);
  });

  it('volunteers get 403; an admin of another part gets 404', async () => {
    const volunteer = await loginAs(t, VOLUNTEER_A);
    await add(station('1D'), 403, volunteer);
    const seedAdmin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
    const other = await t.prisma.appUser.create({
      data: {
        organizationId: seedAdmin.organizationId,
        name: 'Part 2 Admin',
        phone: '+919999900190',
      },
    });
    await t.prisma.roleAssignment.create({
      data: { userId: other.id, role: 'admin', geographyNodeId: ids.part2 },
    });
    await add(station('1D'), 404, await loginAs(t, '+919999900190'));
    expect(await t.prisma.geographyNode.count({ where: { code: '1D' } })).toBe(0);
  });

  it('a later import of the part links to it instead of adding another', async () => {
    const part = await t.prisma.geographyNode.findUniqueOrThrow({ where: { id: ids.part1 } });
    const batch = (
      await admin.http
        .post('/v1/imports/batches')
        .set('Idempotency-Key', randomUUID())
        .send({ targetNodeId: part.id })
        .expect(201)
    ).body as BatchView;
    const fileId = randomUUID();
    const counts = { male: 3, female: 0, thirdGender: 0, total: 3 };
    const printed = (number: string) => ({ number, name: 'Synthetic', address: 'Synthetic' });
    await t.prisma.importFile.create({
      data: {
        id: fileId,
        batchId: batch.id,
        programId: part.programId,
        fileRef: `imports/${batch.id}/${fileId}.pdf`,
        originalName: 'synthetic-part-1.pdf',
        sizeBytes: 1000,
        checksum: createHash('sha256').update(fileId).digest('hex'),
        status: 'ready',
        pageCount: 3,
        partNodeId: part.id,
        extractionMethod: 'ocr',
        qualityScore: 0.9,
        printedTotals: { startSerial: 1, endSerial: 3, counts },
        extractedTotals: counts,
        detectedHeader: {
          header: {
            stateCode: 'S99',
            acNumber: 101,
            partNumber: 1,
            revisionYear: 2027,
            revisionType: 'Synthetic Revision 2027',
            pollingStation: printed('1'),
            auxiliaryStations: [printed('1A'), printed('1B')],
          },
          matching: {
            partNodeId: part.id,
            proposedPart: null,
            stations: [],
            previousSourceVersionId: null,
          },
          issues: [],
          pageImages: [],
        },
        extractedAt: new Date(),
      },
    });
    await t.prisma.importRowResult.createMany({
      data: [1, 2, 3].map((serial) => ({
        importFileId: fileId,
        page: 3,
        boxIndex: serial - 1,
        sectionNo: 1,
        serialNo: serial,
        status: 'accepted' as const,
        messages: [],
        rawText: `${serial} synthetic`,
        extractedValues: {
          epic: `TST95000${serial}`,
          name: `Synthetic Person ${serial}`,
          relationType: 'father',
          relativeName: 'Synthetic Relative',
          houseNumber: `1-${serial * 3}`,
          age: 40,
          gender: 'male',
          printedSerial: serial,
          marker: null,
        },
        fieldConfidence: { epic: 0.95 },
      })),
    });
    await admin.http.post(`/v1/imports/files/${fileId}/confirm`).send({}).expect(202);
    await t.app.get(ImportConfirmService).drain();

    const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file.status).toBe('confirmed');
    const stations = await t.prisma.geographyNode.findMany({
      where: { parentId: ids.part1, type: 'polling_station' },
      orderBy: { code: 'asc' },
    });
    expect(stations.map((s) => s.code)).toEqual(['1', '1A', '1B']);
    expect(stations[2]!.id).toBe(ids.station1b);
    const committed = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'import.file.committed', resourceId: fileId },
    });
    expect(committed.metadata).toMatchObject({ stationsCreated: 0 });
    // Its coverage still applies: serials 1–3 are in 1B.
    const voters = await t.prisma.voter.findMany({
      where: { importFileId: fileId },
      orderBy: { serialNo: 'asc' },
    });
    expect(voters.map((v) => v.pollingStationId)).toEqual([
      ids.station1b,
      ids.station1b,
      ids.station1b,
    ]);
  });
});
