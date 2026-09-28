import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { CurrentScope, Roles } from '../src/authz/decorators';
import { type Scope, ScopeService } from '../src/authz/scope.service';
import { foundInScope, inScope } from '../src/authz/scoped-query';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { PrismaService } from '../src/database/prisma.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// Seed (synthetic), in this file's own database: AC 101 → parts 1 and 2 →
// stations 1 and 1A (auxiliary, both in part 1) and 2 (part 2). Volunteer A
// is assigned to station 1, volunteer B to station 2, the admin to AC 101.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';
const DAY = 24 * 60 * 60 * 1000;

// Booth-level routes as future features will write them, for these tests only.
@Controller('test-scope')
class ScopedTestController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('households')
  async list(@CurrentScope() scope: Scope): Promise<string[]> {
    const rows = await this.prisma.household.findMany({
      where: inScope(scope),
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  @Get('households/:id')
  async one(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    const household = await this.prisma.household.findFirst({
      where: { id, ...inScope(scope) },
      select: { id: true },
    });
    return foundInScope(household, 'Household');
  }

  @Roles('admin', 'campaign_manager')
  @Get('managers-only')
  managersOnly(): { ok: true } {
    return { ok: true };
  }
}

describe('GeoScopeGuard and scoped queries (real Postgres)', () => {
  let t: TestApp;
  let scopes: ScopeService;
  const station = (code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } });
  const userId = async (phone: string) =>
    (await t.prisma.appUser.findUniqueOrThrow({ where: { phone } })).id;
  const sorted = (ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    t = await createTestApp(undefined, { controllers: [ScopedTestController] });
    scopes = t.app.get(ScopeService);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('scope resolution', () => {
    it('a booth-level assignment gives exactly that booth', async () => {
      const scope = await scopes.resolve(await userId(VOLUNTEER_A));
      expect(scope.roles).toEqual(['volunteer']);
      expect(scope.boothIds).toEqual([(await station('1')).id]);
    });

    it('a constituency-level assignment gives every booth under it, auxiliary included', async () => {
      const scope = await scopes.resolve(await userId(ADMIN));
      const all = await t.prisma.geographyNode.findMany({ where: { type: 'polling_station' } });
      expect(all.map((node) => node.code).sort()).toEqual(['1', '1A', '2']);
      expect(sorted(scope.boothIds)).toEqual(sorted(all.map((node) => node.id)));
      expect(scope.roles).toEqual(['admin']);
    });

    it('a part-level assignment gives the part’s main and auxiliary booths; assignments combine', async () => {
      const volunteerB = await userId(VOLUNTEER_B);
      const part1 = await t.prisma.geographyNode.findFirstOrThrow({
        where: { type: 'part', code: '1' },
      });
      const assignment = await t.prisma.roleAssignment.create({
        data: { userId: volunteerB, role: 'campaign_manager', geographyNodeId: part1.id },
      });

      const scope = await scopes.resolve(volunteerB);
      const expected = await Promise.all(['1', '1A', '2'].map(async (c) => (await station(c)).id));
      expect(sorted(scope.boothIds)).toEqual(sorted(expected));
      expect(sorted(scope.roles)).toEqual(['campaign_manager', 'volunteer']);

      await t.prisma.roleAssignment.delete({ where: { id: assignment.id } });
    });

    it('ignores expired and future assignments', async () => {
      const volunteerA = await userId(VOLUNTEER_A);
      const station2 = await station('2');
      const now = Date.now();
      const created = await t.prisma.roleAssignment.createManyAndReturn({
        data: [
          {
            userId: volunteerA,
            role: 'volunteer',
            geographyNodeId: station2.id,
            validFrom: new Date(now - 10 * DAY),
            validUntil: new Date(now - DAY),
          },
          {
            userId: volunteerA,
            role: 'volunteer',
            geographyNodeId: station2.id,
            validFrom: new Date(now + DAY),
          },
        ],
      });

      const scope = await scopes.resolve(volunteerA);
      expect(scope.boothIds).toEqual([(await station('1')).id]);

      await t.prisma.roleAssignment.deleteMany({ where: { id: { in: created.map((a) => a.id) } } });
    });

    it('a user without assignments sees nothing', async () => {
      const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
      const nobody = await t.prisma.appUser.create({
        data: { organizationId: admin.organizationId, name: 'Unassigned', phone: '+919999900077' },
      });
      await expect(scopes.resolve(nobody.id)).resolves.toEqual({
        userId: nobody.id,
        roles: [],
        boothIds: [],
      });

      const { http } = await loginAs(t, nobody.id);
      await expect(http.get('/v1/test-scope/households').expect(200)).resolves.toMatchObject({
        body: [],
      });
    });
  });

  describe('scoped routes', () => {
    it('list only the caller’s booths', async () => {
      const station1 = await station('1');
      const expected = await t.prisma.household.findMany({
        where: { pollingStationId: station1.id },
        select: { id: true },
      });
      expect(expected.length).toBeGreaterThan(0);

      const { http } = await loginAs(t, VOLUNTEER_A);
      const res = await http.get('/v1/test-scope/households').expect(200);
      expect(sorted(res.body as string[])).toEqual(sorted(expected.map((row) => row.id)));

      const admin = await loginAs(t, ADMIN);
      const all = await admin.http.get('/v1/test-scope/households').expect(200);
      expect(all.body).toHaveLength(await t.prisma.household.count());
    });

    it('answer 404, not 403, for a record outside the scope, same as for one that doesn’t exist', async () => {
      const station2 = await station('2');
      const theirs = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station2.id },
      });
      const { http } = await loginAs(t, VOLUNTEER_A);

      const outside = await http.get(`/v1/test-scope/households/${theirs.id}`).expect(404);
      const missing = await http
        .get('/v1/test-scope/households/00000000-0000-7000-8000-000000000000')
        .expect(404);
      const shape = (body: unknown) => {
        const { code, message } = body as ApiErrorBody;
        return { code, message };
      };
      expect(shape(outside.body)).toEqual({ code: 'NOT_FOUND', message: 'Household not found' });
      expect(shape(outside.body)).toEqual(shape(missing.body));

      // Volunteer B, whose booth it is, can read it.
      const owner = await loginAs(t, VOLUNTEER_B);
      await owner.http.get(`/v1/test-scope/households/${theirs.id}`).expect(200);
    });

    it('@Roles() refuses other roles with 403 and admits the listed ones', async () => {
      const volunteer = await loginAs(t, VOLUNTEER_A);
      const res = await volunteer.http.get('/v1/test-scope/managers-only').expect(403);
      expect((res.body as ApiErrorBody).code).toBe('FORBIDDEN');

      const admin = await loginAs(t, ADMIN);
      await admin.http.get('/v1/test-scope/managers-only').expect(200);
    });

    it('still need a token first (401 before any scope check)', async () => {
      await t.http().get('/v1/test-scope/households').expect(401);
      await t.http().get('/v1/test-scope/managers-only').expect(401);
    });
  });
});
