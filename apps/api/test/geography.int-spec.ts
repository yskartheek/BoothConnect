import type { PrismaService } from '../src/database/prisma.service';
import type { GeographyNodeType } from '../src/generated/prisma/client';
import { connectDatabase, expectDbError, inRollback, type Tx } from './support/database';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('geography tree (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createProgram(tx: Tx): Promise<string> {
    const org = await tx.organization.create({ data: { name: 'Test org' } });
    const program = await tx.electionProgram.create({
      data: { organizationId: org.id, name: 'Test program', type: 'general_election' },
    });
    return program.id;
  }

  function node(
    tx: Tx,
    programId: string,
    type: GeographyNodeType,
    code: string,
    parentId?: string,
    isAuxiliary = false,
  ) {
    return tx.geographyNode.create({
      data: { programId, type, code, name: `${type} ${code}`, parentId, isAuxiliary },
    });
  }

  /** State → PC → AC → 2 parts → 3 stations (one auxiliary). */
  async function createTree(tx: Tx) {
    const programId = await createProgram(tx);
    const state = await node(tx, programId, 'state', 'S29');
    const pc = await node(tx, programId, 'pc', '6', state.id);
    const ac = await node(tx, programId, 'ac', '40', pc.id);
    const part408 = await node(tx, programId, 'part', '408', ac.id);
    const part409 = await node(tx, programId, 'part', '409', ac.id);
    const ps408 = await node(tx, programId, 'polling_station', '408', part408.id);
    const ps408a = await node(tx, programId, 'polling_station', '408A', part408.id, true);
    const ps409 = await node(tx, programId, 'polling_station', '409', part409.id);
    return { programId, state, pc, ac, part408, part409, ps408, ps408a, ps409 };
  }

  it('finds all polling stations under an AC with one closure query', async () => {
    const codes = await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      const stations = await tx.geographyNode.findMany({
        where: { type: 'polling_station', ancestors: { some: { ancestorId: tree.ac.id } } },
        orderBy: { code: 'asc' },
      });
      return stations.map((station) => station.code);
    });
    expect(codes).toEqual(['408', '408A', '409']);
  });

  it('finds all ancestors of a station, nearest first, with one closure query', async () => {
    const path = await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      const rows = await tx.geographyClosure.findMany({
        where: { descendantId: tree.ps408a.id },
        orderBy: { depth: 'asc' },
        include: { ancestor: true },
      });
      return rows.map((row) => `${row.depth}:${row.ancestor.type}:${row.ancestor.code}`);
    });
    expect(path).toEqual([
      '0:polling_station:408A',
      '1:part:408',
      '2:ac:40',
      '3:pc:6',
      '4:state:S29',
    ]);
  });

  it('rejects a node whose parent is not the level directly above', async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      await expectDbError(
        tx,
        () => node(tx, tree.programId, 'part', '999', tree.pc.id),
        /A part can't be placed under a pc/,
      );
      await expectDbError(
        tx,
        () => node(tx, tree.programId, 'ac', '41'),
        /A ac must have a pc as its parent/,
      );
    });
  });

  it('rejects a parent from another program', async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      const otherProgram = await createProgram(tx);
      await expectDbError(
        tx,
        () => node(tx, otherProgram, 'pc', '7', tree.state.id),
        /same program/,
      );
    });
  });

  it('rejects duplicate codes among siblings and among states', async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      await expectDbError(
        tx,
        () => node(tx, tree.programId, 'part', '408', tree.ac.id),
        /Unique constraint/,
      );
      await expectDbError(tx, () => node(tx, tree.programId, 'state', 'S29'), /Unique constraint/);
    });
  });

  it('only allows polling stations to be auxiliary', async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      await expectDbError(
        tx,
        () => node(tx, tree.programId, 'part', '410', tree.ac.id, true),
        /geography_node_auxiliary_station_check/,
      );
    });
  });

  it("doesn't allow moving a node, but allows renaming it", async () => {
    await inRollback(prisma, async (tx) => {
      const tree = await createTree(tx);
      await expectDbError(
        tx,
        () =>
          tx.geographyNode.update({
            where: { id: tree.ps409.id },
            data: { parentId: tree.part408.id },
          }),
        /parent, type and program can't be changed/,
      );
      const renamed = await tx.geographyNode.update({
        where: { id: tree.part408.id },
        data: { name: 'Indira Nagar, Tellapur' },
      });
      expect(renamed.name).toBe('Indira Nagar, Tellapur');
    });
  });
});
