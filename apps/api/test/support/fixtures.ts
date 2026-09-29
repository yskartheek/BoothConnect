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

type Tree = Awaited<ReturnType<typeof createTree>>;

let checksumCounter = 0;
function fakeChecksum(): string {
  checksumCounter += 1;
  return checksumCounter.toString(16).padStart(64, '0');
}

/** An import batch, file and source version for one part, as if a roll had been confirmed. */
export async function createImportedPart(
  tx: Tx,
  tree: Tree,
  part: Tree['part408'],
  previousVersionId?: string,
) {
  const admin = await createUser(tx, tree.orgId, 'Importer');
  const batch = await tx.importBatch.create({
    data: { programId: tree.programId, targetNodeId: tree.ac.id, uploadedById: admin.id },
  });
  const checksum = fakeChecksum();
  const sourceVersion = await tx.sourceVersion.create({
    data: {
      programId: tree.programId,
      partNodeId: part.id,
      revisionYear: 2026,
      revisionType: 'Special Intensive Revision 2026',
      rollIdentification: 'Draft Electoral Roll of Special Intensive Revision, 2026',
      checksum,
      previousVersionId,
    },
  });
  const file = await tx.importFile.create({
    data: {
      batchId: batch.id,
      programId: tree.programId,
      fileRef: `imports/${batch.id}/${checksum}.pdf`,
      originalName: `part-${part.code}.pdf`,
      sizeBytes: 1_000n,
      checksum,
      partNodeId: part.id,
      sourceVersionId: sourceVersion.id,
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });
  return { sourceVersion, file };
}

export function createHousehold(
  tx: Tx,
  partId: string,
  pollingStationId: string,
  sourceVersionId: string,
  houseKey: string,
) {
  return tx.household.create({
    data: { partId, pollingStationId, sourceVersionId, houseKey, displayAddress: houseKey },
  });
}

let epicCounter = 0;

/** A synthetic voter; EPICs use the fake prefix TST. */
export function createVoter(
  tx: Tx,
  data: {
    programId: string;
    householdId: string;
    partId: string;
    pollingStationId: string;
    sourceVersionId: string;
    importFileId: string;
    sectionNo?: number;
    serialNo: number;
    sourceVoterId?: string;
  },
) {
  epicCounter += 1;
  const epic = data.sourceVoterId ?? `TST${String(epicCounter).padStart(7, '0')}`;
  return tx.voter.create({
    data: {
      ...data,
      sectionNo: data.sectionNo ?? 1,
      sourceVoterId: epic,
      sourceData: {
        name: `Voter ${data.serialNo}`,
        age: 30,
        gender: 'female',
        relationType: 'father',
      },
    },
  });
}

export function createConsent(
  tx: Tx,
  data: {
    purpose: string;
    subjectVoterId?: string;
    subjectHouseholdId?: string;
    capturedById?: string;
  },
) {
  return tx.consent.create({
    data: { ...data, noticeVersion: '2026.1', capturedMethod: 'in_person_verbal' },
  });
}
