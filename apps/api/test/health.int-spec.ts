import { createTestApp, type TestApp } from './support/app';

// Full app with the real database and Redis checks: proves the API can reach
// both services, and that each test file runs on its own seeded database.
describe('GET /v1/health (real services)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('reports the database and Redis as up', async () => {
    const res = await t.http().get('/v1/health');
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
    expect(res.status).toBe(200);
  });

  it("uses this test file's own database, migrated and seeded", async () => {
    const [row] = await t.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    const db = row?.db;
    expect(db).toBe(process.env.IT_SUITE_DATABASE);
    expect(db).toMatch(/_it_[0-9a-f]{12}$/);
    await expect(t.prisma.geographyNode.count({ where: { code: 'S99' } })).resolves.toBe(1);
  });
});
