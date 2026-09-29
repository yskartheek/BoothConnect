import { createHash, randomUUID } from 'node:crypto';

import type { Prisma } from '../src/generated/prisma/client';
import type { BatchView } from '../src/imports/imports.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Rows here are made up (synthetic names and EPICs), including values built
// to look like spreadsheet formulas; never real roll data.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

/** A small RFC 4180 parser: enough to read back what the API wrote. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += c;
  }
  return rows;
}

describe('GET /v1/imports/files/:id/rejections.csv', () => {
  let t: TestApp;
  let admin: SignedIn;

  const node = (type: 'ac' | 'part', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });

  const seedFile = async (
    targetNodeId: string,
    rows: Omit<Prisma.ImportRowResultCreateManyInput, 'importFileId'>[],
    batchId?: string,
  ) => {
    const batch = batchId
      ? await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })
      : await t.prisma.importBatch.findUniqueOrThrow({
          where: {
            id: (
              (
                await admin.http
                  .post('/v1/imports/batches')
                  .set('Idempotency-Key', randomUUID())
                  .send({ targetNodeId })
                  .expect(201)
              ).body as BatchView
            ).id,
          },
        });
    const id = randomUUID();
    await t.prisma.importFile.create({
      data: {
        id,
        batchId: batch.id,
        programId: batch.programId,
        fileRef: `imports/${batch.id}/${id}.pdf`,
        originalName: 'Part 1 (synthetic).pdf',
        sizeBytes: 100,
        checksum: createHash('sha256').update(id).digest('hex'),
        status: 'needs_review',
      },
    });
    await t.prisma.importRowResult.createMany({
      data: rows.map((r) => ({ ...r, importFileId: id })),
    });
    return id;
  };

  const values = (overrides: Record<string, unknown> = {}) => ({
    epic: 'TST1000001',
    name: 'Synthetic Person',
    relationType: 'father',
    relativeName: 'Synthetic Relative',
    houseNumber: '1-2',
    age: 30,
    gender: 'male',
    printedSerial: 1,
    marker: null,
    ...overrides,
  });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await loginAs(t, ADMIN);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('exports the rejected and warning rows, with formula-like values neutralised', async () => {
    const fileId = await seedFile((await node('ac', '101')).id, [
      {
        page: 3,
        boxIndex: 0,
        sectionNo: 1,
        serialNo: 1,
        status: 'accepted',
        extractedValues: values(),
      },
      {
        page: 3,
        boxIndex: 1,
        sectionNo: 1,
        serialNo: 2,
        status: 'warning',
        messages: [
          {
            code: 'field.low_confidence',
            severity: 'warning',
            message: 'name read with low confidence (0.40)',
            field: 'rows[2].name',
          },
        ],
        extractedValues: values({
          name: '=HYPERLINK("http://example.invalid","click")',
          relativeName: '+91 99999 00000',
          houseNumber: '-12',
          epic: '@SUM(A1)',
        }),
        correctedValues: { age: 31 },
      },
      {
        page: 4,
        boxIndex: 0,
        sectionNo: 2,
        serialNo: 31,
        status: 'rejected',
        messages: [
          {
            code: 'row.rejected',
            severity: 'info',
            message: 'Printed twice, see serial 30',
            field: null,
            source: 'review',
          },
        ],
        extractedValues: values({ name: 'Comma, "Quoted" Person', houseNumber: '\t7' }),
      },
    ]);

    const res = await admin.http
      .get(`/v1/imports/files/${fileId}/rejections.csv`)
      .buffer(true)
      .parse((response, done) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => done(null, body));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="rejections-Part_1_synthetic_.csv"',
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    const text = res.body as string;
    expect(text.startsWith('﻿')).toBe(true);

    const [header, ...rows] = parseCsv(text.slice(1));
    expect(header).toEqual([
      'page',
      'box',
      'section',
      'serial',
      'status',
      'epic',
      'name',
      'relationType',
      'relativeName',
      'houseNumber',
      'age',
      'gender',
      'marker',
      'corrections',
      'messages',
    ]);
    // The accepted row isn't exported; the others are, in roll order.
    expect(rows.map((r) => r.slice(0, 5))).toEqual([
      ['3', '1', '1', '2', 'warning'],
      ['4', '0', '2', '31', 'rejected'],
    ]);
    const [warning, rejected] = rows as [string[], string[]];
    const col = (row: string[], name: string) => row[header!.indexOf(name)];
    // Plan §8: values starting with = + - @ (or a tab) are neutralised.
    expect(col(warning, 'name')).toBe(`'=HYPERLINK("http://example.invalid","click")`);
    expect(col(warning, 'relativeName')).toBe("'+91 99999 00000");
    expect(col(warning, 'houseNumber')).toBe("'-12");
    expect(col(warning, 'epic')).toBe("'@SUM(A1)");
    expect(col(rejected, 'houseNumber')).toBe("'\t7");
    for (const row of rows) {
      for (const cell of row) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
    }
    // Commas and quotes survive the round trip.
    expect(col(rejected, 'name')).toBe('Comma, "Quoted" Person');
    expect(col(warning, 'corrections')).toBe('age=31');
    expect(col(warning, 'messages')).toBe(
      'field.low_confidence: name read with low confidence (0.40)',
    );
    expect(col(rejected, 'messages')).toBe('row.rejected: Printed twice, see serial 30');

    const audit = await t.prisma.auditEvent.findMany({
      where: { action: 'import.file.rejections_export', resourceId: fileId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: admin.userId, metadata: { rows: 2 } });
  });

  it('streams large files completely, in roll order', async () => {
    const rows = Array.from({ length: 1_203 }, (_, i) => ({
      page: 3 + Math.floor(i / 30),
      boxIndex: i % 30,
      sectionNo: 1,
      serialNo: i + 1,
      status: 'warning' as const,
      extractedValues: values({ epic: `TST${1_000_000 + i}` }),
    }));
    const fileId = await seedFile((await node('ac', '101')).id, rows);
    const res = await admin.http.get(`/v1/imports/files/${fileId}/rejections.csv`).expect(200);
    const [, ...lines] = parseCsv(res.text.slice(1));
    expect(lines).toHaveLength(1_203);
    expect(lines.map((l) => Number(l[3]))).toEqual(rows.map((r) => r.serialNo));
  });

  it('404 outside the admin’s area or for an unknown file; 403 for a volunteer', async () => {
    const ac = await node('ac', '101');
    const fileId = await seedFile(ac.id, []);
    const volunteer = await loginAs(t, VOLUNTEER_A);
    await volunteer.http.get(`/v1/imports/files/${fileId}/rejections.csv`).expect(403);
    await admin.http.get(`/v1/imports/files/${randomUUID()}/rejections.csv`).expect(404);

    const other = await t.prisma.geographyNode.create({
      data: {
        programId: ac.programId,
        parentId: ac.parentId,
        type: 'ac',
        code: '130',
        name: 'Elsewhere',
      },
    });
    const outside = await t.prisma.importBatch.create({
      data: { programId: ac.programId, targetNodeId: other.id, uploadedById: admin.userId },
    });
    const hidden = await seedFile(other.id, [], outside.id);
    await admin.http.get(`/v1/imports/files/${hidden}/rejections.csv`).expect(404);
    // Nothing was exported, so nothing was audited.
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'import.file.rejections_export', resourceId: hidden },
      }),
    ).toBe(0);
  });
});
