import type { GeographyNodeType } from '../../src/generated/prisma/client';
import type { Tx } from './database';

// Builders for integration tests. Everything runs inside `inRollback`, so
// nothing needs cleaning up. Data is synthetic.

export async function createProgram(
  tx: Tx,
  orgName = 'Test org',
): Promise<{ orgId: string; programId: string }> {
  const org = await tx.organization.create({ data: { name: orgName } });
  const program = await tx.electionProgram.create({
    data: { organizationId: org.id, name: 'Test program', type: 'general_election' },
  });
  return { orgId: org.id, programId: program.id };
}

export function createNode(
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

/** State S29 → PC 6 → AC 40 → parts 408 and 409 → stations 408, 408A (auxiliary) and 409. */
export async function createTree(tx: Tx, orgName?: string) {
  const { orgId, programId } = await createProgram(tx, orgName);
  const state = await createNode(tx, programId, 'state', 'S29');
  const pc = await createNode(tx, programId, 'pc', '6', state.id);
  const ac = await createNode(tx, programId, 'ac', '40', pc.id);
  const part408 = await createNode(tx, programId, 'part', '408', ac.id);
  const part409 = await createNode(tx, programId, 'part', '409', ac.id);
  const ps408 = await createNode(tx, programId, 'polling_station', '408', part408.id);
  const ps408a = await createNode(tx, programId, 'polling_station', '408A', part408.id, true);
  const ps409 = await createNode(tx, programId, 'polling_station', '409', part409.id);
  return { orgId, programId, state, pc, ac, part408, part409, ps408, ps408a, ps409 };
}

let phoneCounter = 0;

export function createUser(tx: Tx, organizationId: string, name = 'Test user') {
  phoneCounter += 1;
  return tx.appUser.create({
    data: { organizationId, name, phone: `+91900000${String(phoneCounter).padStart(4, '0')}` },
  });
}
