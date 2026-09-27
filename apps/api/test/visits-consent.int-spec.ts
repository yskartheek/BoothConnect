import { randomUUID } from 'node:crypto';

import type { PrismaService } from '../src/database/prisma.service';
import { connectDatabase, expectDbError, inRollback, type Tx } from './support/database';
import {
  createConsent,
  createHousehold,
  createImportedPart,
  createTree,
  createUser,
  createVoter,
} from './support/fixtures';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('visits and consent (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function setup(tx: Tx) {
    const tree = await createTree(tx);
    const { sourceVersion, file } = await createImportedPart(tx, tree, tree.part408);
    const household = await createHousehold(
      tx,
      tree.part408.id,
      tree.ps408.id,
      sourceVersion.id,
      '4-76',
    );
    const otherHousehold = await createHousehold(
      tx,
      tree.part408.id,
      tree.ps408.id,
      sourceVersion.id,
      '4-77',
    );
    const member = (householdId: string, serialNo: number) =>
      createVoter(tx, {
        programId: tree.programId,
        householdId,
        partId: tree.part408.id,
        pollingStationId: tree.ps408.id,
        sourceVersionId: sourceVersion.id,
        importFileId: file.id,
        serialNo,
      });
    const voter = await member(household.id, 1);
    const neighbour = await member(otherHousehold.id, 2);
    const volunteer = await createUser(tx, tree.orgId, 'Volunteer');
    const visit = (extra: Record<string, unknown> = {}) =>
      tx.visit.create({
        data: {
          householdId: household.id,
          volunteerId: volunteer.id,
          startedAt: new Date('2026-10-02T04:30:00Z'),
          completedAt: new Date('2026-10-02T04:40:00Z'),
          outcome: 'completed',
          formVersion: '2026.1',
          clientId: randomUUID(),
          ...extra,
        },
      });
    return { tree, household, otherHousehold, voter, neighbour, volunteer, visit };
  }

  it('rejects a second visit with the same client_id (a repeated upload)', async () => {
    await inRollback(prisma, async (tx) => {
      const { visit } = await setup(tx);
      const clientId = randomUUID();
      await visit({ clientId });
      await expectDbError(tx, () => visit({ clientId }), /Unique constraint/);
    });
  });

  it('records who was met, only from the visited household', async () => {
    await inRollback(prisma, async (tx) => {
      const { visit, voter, neighbour } = await setup(tx);
      const v = await visit();
      await tx.visitMember.create({ data: { visitId: v.id, voterId: voter.id } });
      await expectDbError(
        tx,
        () => tx.visitMember.create({ data: { visitId: v.id, voterId: neighbour.id } }),
        /must belong to the visited household/,
      );
    });
  });

  it('keeps visits immutable; a correction is a new visit to the same household', async () => {
    await inRollback(prisma, async (tx) => {
      const { visit, otherHousehold } = await setup(tx);
      const wrong = await visit({ outcome: 'no_one_available' });
      await expectDbError(
        tx,
        () => tx.visit.update({ where: { id: wrong.id }, data: { outcome: 'completed' } }),
        /Visit history is immutable/,
      );
      await expectDbError(tx, () => tx.visit.delete({ where: { id: wrong.id } }), /immutable/);
      const fixed = await visit({ outcome: 'completed', correctsVisitId: wrong.id });
      expect(fixed.correctsVisitId).toBe(wrong.id);
      await expectDbError(
        tx,
        () => visit({ householdId: otherHousehold.id, correctsVisitId: wrong.id }),
        /same household|Unique constraint/,
      );
    });
  });

  it('checks visit times and that the volunteer is from the same organization', async () => {
    await inRollback(prisma, async (tx) => {
      const { visit } = await setup(tx);
      await expectDbError(
        tx,
        () => visit({ completedAt: new Date('2026-10-02T04:00:00Z') }),
        /visit_times_check/,
      );
      const other = await createTree(tx, 'Other org');
      const outsider = await createUser(tx, other.orgId, 'Outsider');
      await expectDbError(
        tx,
        () => visit({ volunteerId: outsider.id }),
        /volunteer must belong to the household's organization/,
      );
      await visit({ outcome: 'refused', completedAt: null });
    });
  });

  it('allows a consent to be withdrawn once, but never edited or deleted', async () => {
    await inRollback(prisma, async (tx) => {
      const { voter, volunteer } = await setup(tx);
      const consent = await createConsent(tx, {
        purpose: 'caste_community',
        subjectVoterId: voter.id,
        capturedById: volunteer.id,
      });
      await expectDbError(
        tx,
        () => tx.consent.update({ where: { id: consent.id }, data: { purpose: 'mobile_number' } }),
        /can only be withdrawn/,
      );
      await tx.consent.update({
        where: { id: consent.id },
        data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawnById: volunteer.id },
      });
      await expectDbError(
        tx,
        () =>
          tx.consent.update({
            where: { id: consent.id },
            data: { status: 'granted', withdrawnAt: null },
          }),
        /can only be withdrawn/,
      );
      await expectDbError(
        tx,
        () => tx.consent.delete({ where: { id: consent.id } }),
        /can't be deleted/,
      );
      await expectDbError(
        tx,
        () => createConsent(tx, { purpose: 'caste_community' }),
        /consent_one_subject_check/,
      );
    });
  });

  it('only accepts a field value whose consent is granted, for that field, by that person', async () => {
    await inRollback(prisma, async (tx) => {
      const { tree, voter, neighbour } = await setup(tx);
      const caste = await tx.fieldDefinition.create({
        data: {
          programId: tree.programId,
          key: 'caste_community',
          labelKey: 'field.caste_community',
          appliesTo: 'voter',
          type: 'text',
          purpose: 'Test purpose',
          isRestricted: true,
          enabled: true,
          requiresConsent: true,
          legalBasis: 'Test legal basis',
        },
      });
      const write = (consentId: string) =>
        tx.fieldValue.create({
          data: {
            entityType: 'voter',
            entityId: voter.id,
            fieldDefinitionId: caste.id,
            value: 'test value',
            sourceType: 'volunteer_collected',
            consentId,
          },
        });

      const theirs = await createConsent(tx, {
        purpose: 'caste_community',
        subjectVoterId: neighbour.id,
      });
      await expectDbError(tx, () => write(theirs.id), /given by someone else/);

      const otherPurpose = await createConsent(tx, {
        purpose: 'mobile_number',
        subjectVoterId: voter.id,
      });
      await expectDbError(
        tx,
        () => write(otherPurpose.id),
        /is for "mobile_number", not "caste_community"/,
      );

      const ok = await createConsent(tx, { purpose: 'caste_community', subjectVoterId: voter.id });
      await write(ok.id);

      await tx.consent.update({
        where: { id: ok.id },
        data: { status: 'withdrawn', withdrawnAt: new Date() },
      });
      await expectDbError(tx, () => write(ok.id), /has been withdrawn/);
    });
  });

  it('only accepts a household location consent for "household_location" from that household', async () => {
    await inRollback(prisma, async (tx) => {
      const { household, otherHousehold, voter } = await setup(tx);
      const locate = (locationConsentId: string, id = household.id) =>
        tx.household.update({
          where: { id },
          data: {
            locationLat: 17.4575,
            locationLng: 78.2934,
            locationCapturedAt: new Date(),
            locationConsentId,
          },
        });
      const byMember = await createConsent(tx, {
        purpose: 'household_location',
        subjectVoterId: voter.id,
      });
      await locate(byMember.id);
      await expectDbError(
        tx,
        () => locate(byMember.id, otherHousehold.id),
        /given by someone else/,
      );
      const wrongPurpose = await createConsent(tx, {
        purpose: 'mobile_number',
        subjectVoterId: voter.id,
      });
      await expectDbError(tx, () => locate(wrongPurpose.id), /not "household_location"/);
    });
  });
});
