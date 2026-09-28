import type { Me } from '../src/users/me.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// Seed users (synthetic), in this file's own database. Volunteer A is
// assigned to polling station 1 of part 1 in AC 101.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const DAY = 24 * 60 * 60 * 1000;

describe('GET /v1/me (real Postgres)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a signed-in user', async () => {
    await t.http().get('/v1/me').expect(401);
  });

  it('a volunteer sees their profile and only their own booth assignment, with its path', async () => {
    const { http, userId } = await loginAs(t, VOLUNTEER_A);
    const me = (await http.get('/v1/me').expect(200)).body as Me;

    expect(me).toMatchObject({
      id: userId,
      phone: VOLUNTEER_A,
      preferredLanguage: expect.any(String),
      mfaState: 'not_enrolled',
    });
    expect(me.assignments).toHaveLength(1);
    const [assignment] = me.assignments;
    expect(assignment).toMatchObject({
      role: 'volunteer',
      validUntil: null,
      node: { type: 'polling_station', code: '1', isAuxiliary: false },
    });
    expect(assignment?.path.map((node) => `${node.type}:${node.code}`)).toEqual([
      'state:S99',
      'pc:1',
      'ac:101',
      'part:1',
      'polling_station:1',
    ]);
    expect(assignment?.path.at(-1)?.id).toBe(assignment?.node.id);
  });

  it('leaves out expired and not-yet-started assignments', async () => {
    const volunteer = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } });
    const station2 = await t.prisma.geographyNode.findFirstOrThrow({
      where: { type: 'polling_station', code: '2' },
    });
    const now = Date.now();
    await t.prisma.roleAssignment.createMany({
      data: [
        {
          userId: volunteer.id,
          role: 'volunteer',
          geographyNodeId: station2.id,
          validFrom: new Date(now - 10 * DAY),
          validUntil: new Date(now - DAY),
        },
        {
          userId: volunteer.id,
          role: 'volunteer',
          geographyNodeId: station2.id,
          validFrom: new Date(now + DAY),
        },
      ],
    });

    const { http } = await loginAs(t, VOLUNTEER_A);
    const me = (await http.get('/v1/me').expect(200)).body as Me;
    expect(me.assignments.map((a) => a.node.code)).toEqual(['1']);
  });

  it('an admin sees their constituency-level assignment', async () => {
    const { http } = await loginAs(t, ADMIN);
    const me = (await http.get('/v1/me').expect(200)).body as Me;
    expect(me.assignments).toHaveLength(1);
    expect(me.assignments[0]).toMatchObject({ role: 'admin', node: { type: 'ac', code: '101' } });
    expect(me.assignments[0]?.path.map((node) => node.type)).toEqual(['state', 'pc', 'ac']);
  });
});
