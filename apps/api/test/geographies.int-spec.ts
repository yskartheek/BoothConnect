import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { Page } from '../src/common/pagination';
import type { GeographyNodeDetail, GeographyNodeView } from '../src/geography/geography.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// Seed (synthetic), in this file's own database: S99 → PC 1 → AC 101 → parts
// 1 and 2 → stations 1 and 1A (part 1) and 2 (part 2). Volunteer A works at
// station 1, the admin on AC 101.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

type List = Page<GeographyNodeView>;

describe('GET /v1/geographies (real Postgres)', () => {
  let t: TestApp;
  const node = (type: 'state' | 'ac' | 'part' | 'polling_station', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });
  const codes = (list: List) => list.items.map((item) => item.code);

  beforeAll(async () => {
    t = await createTestApp();
    // More parts under AC 101, to test natural ordering, paging and search.
    const ac = await node('ac', '101');
    for (const code of ['10', '408', '3']) {
      await t.prisma.geographyNode.create({
        data: {
          programId: ac.programId,
          parentId: ac.id,
          type: 'part',
          code,
          name: `Part ${code}`,
        },
      });
    }
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a signed-in user', async () => {
    await t.http().get('/v1/geographies').expect(401);
  });

  describe('volunteer A (booth 1)', () => {
    it('sees the path down to their booth, and not the other parts or booths', async () => {
      const { http } = await loginAs(t, VOLUNTEER_A);
      const ac = await node('ac', '101');
      const part1 = await node('part', '1');

      const top = (await http.get('/v1/geographies').expect(200)).body as List;
      expect(codes(top)).toEqual(['S99']);

      const parts = (await http.get(`/v1/geographies?parentId=${ac.id}`).expect(200)).body as List;
      expect(codes(parts)).toEqual(['1']);

      const booths = (await http.get(`/v1/geographies?parentId=${part1.id}`).expect(200))
        .body as List;
      expect(codes(booths)).toEqual(['1']);
    });

    it('gets 404 for another booth’s part, and a breadcrumb path for their own booth', async () => {
      const { http } = await loginAs(t, VOLUNTEER_A);
      const part2 = await node('part', '2');
      const res = await http.get(`/v1/geographies/${part2.id}`).expect(404);
      expect((res.body as ApiErrorBody).code).toBe('NOT_FOUND');

      const station1 = await node('polling_station', '1');
      const detail = (await http.get(`/v1/geographies/${station1.id}`).expect(200))
        .body as GeographyNodeDetail;
      expect(detail).toMatchObject({ type: 'polling_station', code: '1' });
      expect(detail.path.map((n) => `${n.type}:${n.code}`)).toEqual([
        'state:S99',
        'pc:1',
        'ac:101',
        'part:1',
      ]);
    });

    it('gets the reservation of States, PCs and ACs (from the master data), and null otherwise', async () => {
      const { http } = await loginAs(t, VOLUNTEER_A);
      const station1 = await node('polling_station', '1');
      const detail = (await http.get(`/v1/geographies/${station1.id}`).expect(200))
        .body as GeographyNodeDetail;
      expect(detail.reservation).toBeNull();
      expect(detail.path.map((n) => [n.code, n.reservation])).toEqual([
        ['S99', null],
        ['1', 'GEN'],
        ['101', 'GENERAL'],
        ['1', null],
      ]);
      const pc = (await http.get(`/v1/geographies?parentId=${detail.path[0]!.id}`).expect(200))
        .body as List;
      expect(pc.items.map((n) => n.reservation)).toEqual(['GEN']);
    });
  });

  describe('admin (AC 101)', () => {
    it('sees every part, in natural code order, and every booth of a part', async () => {
      const { http } = await loginAs(t, ADMIN);
      const ac = await node('ac', '101');
      const parts = (await http.get(`/v1/geographies?parentId=${ac.id}`).expect(200)).body as List;
      expect(codes(parts)).toEqual(['1', '2', '3', '10', '408']);
      expect(parts.nextCursor).toBeNull();

      const part1 = await node('part', '1');
      const booths = (await http.get(`/v1/geographies?parentId=${part1.id}`).expect(200))
        .body as List;
      expect(codes(booths)).toEqual(['1', '1A']);
      expect(booths.items[1]).toMatchObject({ isAuxiliary: true, type: 'polling_station' });
    });

    it('pages through the parts with a stable cursor', async () => {
      const { http } = await loginAs(t, ADMIN);
      const ac = await node('ac', '101');
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const url: string = `/v1/geographies?parentId=${ac.id}&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const page = (await http.get(url).expect(200)).body as List;
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...codes(page));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(['1', '2', '3', '10', '408']);
    });

    it('finds part 408 with q=408, and by name', async () => {
      const { http } = await loginAs(t, ADMIN);
      const ac = await node('ac', '101');
      const byCode = (await http.get(`/v1/geographies?parentId=${ac.id}&q=408`).expect(200))
        .body as List;
      expect(codes(byCode)).toEqual(['408']);

      const byName = (await http.get(`/v1/geographies?parentId=${ac.id}&q=part 4`).expect(200))
        .body as List;
      expect(codes(byName)).toEqual(['408']);
    });

    it('treats % and _ in q as literal characters', async () => {
      const { http } = await loginAs(t, ADMIN);
      const ac = await node('ac', '101');
      const res = (await http.get(`/v1/geographies?parentId=${ac.id}&q=%25`).expect(200))
        .body as List;
      expect(res.items).toEqual([]);
    });
  });

  it('an admin of a State also sees the program’s other States, PCs and ACs, but not their parts', async () => {
    const s99 = await node('state', 'S99');
    const seedAdmin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
    // Another State with a PC, an AC and a part, outside everyone's assignments.
    const s98 = await t.prisma.geographyNode.create({
      data: { programId: s99.programId, type: 'state', code: 'S98', name: 'Other State' },
    });
    const pc = await t.prisma.geographyNode.create({
      data: { programId: s99.programId, parentId: s98.id, type: 'pc', code: '9', name: 'Other PC' },
    });
    const ac = await t.prisma.geographyNode.create({
      data: { programId: s99.programId, parentId: pc.id, type: 'ac', code: '90', name: 'Other AC' },
    });
    await t.prisma.geographyNode.create({
      data: {
        programId: s99.programId,
        parentId: ac.id,
        type: 'part',
        code: '1',
        name: 'Other part',
      },
    });
    // The seed admin (AC 101) still sees only the path to their AC.
    const acAdmin = await loginAs(t, ADMIN);
    expect(codes((await acAdmin.http.get('/v1/geographies').expect(200)).body as List)).toEqual([
      'S99',
    ]);
    await acAdmin.http.get(`/v1/geographies/${ac.id}`).expect(404);

    const user = await t.prisma.appUser.create({
      data: {
        organizationId: seedAdmin.organizationId,
        name: 'State admin',
        phone: '+919999900095',
      },
    });
    await t.prisma.roleAssignment.create({
      data: { userId: user.id, role: 'admin', geographyNodeId: s99.id },
    });
    const { http } = await loginAs(t, '+919999900095');
    expect(codes((await http.get('/v1/geographies').expect(200)).body as List)).toEqual([
      'S98',
      'S99',
    ]);
    expect(
      codes((await http.get(`/v1/geographies?parentId=${pc.id}`).expect(200)).body as List),
    ).toEqual(['90']);
    // Parts and booths stay within their own area.
    expect(
      codes((await http.get(`/v1/geographies?parentId=${ac.id}`).expect(200)).body as List),
    ).toEqual([]);
  });

  it('rejects an invalid cursor, type or parentId with 400', async () => {
    const { http } = await loginAs(t, ADMIN);
    await http.get('/v1/geographies?cursor=not-a-cursor').expect(400);
    await http.get('/v1/geographies?type=village').expect(400);
    await http.get('/v1/geographies?parentId=123').expect(400);
    await http.get('/v1/geographies?limit=1000').expect(400);
  });
});
