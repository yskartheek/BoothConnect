import type { Prisma } from '../../generated/prisma/client';

/** A PrismaClient, or a transaction client (tests run the seed in a rolled-back transaction). */
export type SeedClient = Prisma.TransactionClient;
import { FAMILY_NAMES, FEMALE_NAMES, MALE_NAMES, OCCUPATIONS, STREETS } from './names';
import { createRandom, seedId, sha256Hex } from './random';

// Development seed data (plan §7, spec v1.1). Synthetic only: made-up state
// code, fake phone numbers (+91 99999 000xx), fake EPICs (prefix DMO), fake
// addresses. Idempotent: fixed IDs and "skip if it exists" inserts, so running
// it again changes nothing.

export const SEED = {
  adminPhone: '+919999900001',
  volunteerAPhone: '+919999900002',
  volunteerBPhone: '+919999900003',
} as const;

export interface SeedSummary {
  geographyNodes: number;
  users: number;
  households: number;
  voters: number;
  fieldDefinitions: number;
  fieldValues: number;
  consents: number;
}

const id = seedId;

export async function seedDatabase(prisma: SeedClient): Promise<SeedSummary> {
  const random = createRandom(2026);

  // --- Organization and program -------------------------------------------
  const orgId = id('org');
  const programId = id('program');
  await prisma.organization.createMany({
    data: [{ id: orgId, name: 'BoothConnect Demo Organization' }],
    skipDuplicates: true,
  });
  await prisma.electionProgram.createMany({
    data: [
      {
        id: programId,
        organizationId: orgId,
        name: 'Demo General Election 2026',
        type: 'general_election',
        status: 'active',
      },
    ],
    skipDuplicates: true,
  });

  // --- Geography: level by level, so the triggers build the closure table --
  const node = (
    key: string,
    type: 'state' | 'pc' | 'ac' | 'part' | 'polling_station',
    code: string,
    name: string,
    parentKey: string | null,
    metadata: object = {},
    isAuxiliary = false,
  ) => ({
    id: id(`node:${key}`),
    programId,
    parentId: parentKey ? id(`node:${parentKey}`) : null,
    type,
    code,
    name,
    metadata,
    isAuxiliary,
  });
  const levels = [
    [node('state', 'state', 'S99', 'Demo State', null)],
    [node('pc', 'pc', '1', 'Demo Parliamentary Constituency', 'state', { reservation: 'GEN' })],
    [node('ac', 'ac', '101', 'Demo Assembly Constituency', 'pc', { reservation: 'GENERAL' })],
    [
      node('part1', 'part', '1', 'Demo Nagar', 'ac', {
        sections: [
          { no: 1, name: 'Section No 1' },
          { no: 2, name: 'Section No 2' },
        ],
        district: 'Demo District',
        pinCode: '500001',
      }),
      node('part2', 'part', '2', 'Sample Colony', 'ac', {
        sections: [
          { no: 1, name: 'Section No 1' },
          { no: 2, name: 'Section No 2' },
        ],
        district: 'Demo District',
        pinCode: '500002',
      }),
    ],
    [
      node('ps1', 'polling_station', '1', 'Demo Primary School, Room 1', 'part1', {
        stationType: 'general',
        address: 'Demo Primary School, Demo Nagar',
      }),
      node(
        'ps1a',
        'polling_station',
        '1A',
        'Demo Primary School, Room 2',
        'part1',
        {
          stationType: 'general',
          address: 'Demo Primary School, Demo Nagar',
          coverage: { sections: [2] },
        },
        true,
      ),
      node('ps2', 'polling_station', '2', 'Sample High School', 'part2', {
        stationType: 'general',
        address: 'Sample High School, Sample Colony',
      }),
    ],
  ];
  for (const level of levels) {
    await prisma.geographyNode.createMany({ data: level, skipDuplicates: true });
  }
  const acId = id('node:ac');
  const parts = [
    {
      key: 'part1',
      id: id('node:part1'),
      mainStation: id('node:ps1'),
      auxStation: id('node:ps1a'),
    },
    { key: 'part2', id: id('node:part2'), mainStation: id('node:ps2'), auxStation: null },
  ];

  // --- Users and role assignments ------------------------------------------
  const adminId = id('user:admin');
  const volunteerA = id('user:volunteer-a');
  const volunteerB = id('user:volunteer-b');
  await prisma.appUser.createMany({
    data: [
      {
        id: adminId,
        organizationId: orgId,
        name: 'Demo Admin',
        phone: SEED.adminPhone,
        email: 'admin@demo.boothconnect.invalid',
      },
      {
        id: volunteerA,
        organizationId: orgId,
        name: 'Demo Volunteer A',
        phone: SEED.volunteerAPhone,
      },
      {
        id: volunteerB,
        organizationId: orgId,
        name: 'Demo Volunteer B',
        phone: SEED.volunteerBPhone,
      },
    ],
    skipDuplicates: true,
  });
  const validFrom = new Date('2026-01-01T00:00:00Z');
  await prisma.roleAssignment.createMany({
    data: [
      { id: id('role:admin'), userId: adminId, role: 'admin', geographyNodeId: acId, validFrom },
      {
        id: id('role:volunteer-a'),
        userId: volunteerA,
        role: 'volunteer',
        geographyNodeId: id('node:ps1'),
        validFrom,
        grantedById: adminId,
      },
      {
        id: id('role:volunteer-b'),
        userId: volunteerB,
        role: 'volunteer',
        geographyNodeId: id('node:ps2'),
        validFrom,
        grantedById: adminId,
      },
    ],
    skipDuplicates: true,
  });

  // --- A confirmed import per part (source version, batch, file) ------------
  const batchId = id('import-batch');
  await prisma.importBatch.createMany({
    data: [
      {
        id: batchId,
        programId,
        targetNodeId: acId,
        uploadedById: adminId,
        status: 'completed',
        fileCount: parts.length,
        confirmedById: adminId,
        confirmedAt: validFrom,
      },
    ],
    skipDuplicates: true,
  });
  for (const part of parts) {
    const checksum = sha256Hex(`seed-roll:${part.key}`);
    await prisma.sourceVersion.createMany({
      data: [
        {
          id: id(`source-version:${part.key}`),
          programId,
          partNodeId: part.id,
          revisionYear: 2026,
          revisionType: 'Demo Revision 2026',
          rollIdentification: 'Synthetic development roll',
          qualifyingDate: new Date('2026-01-01'),
          publishedOn: new Date('2026-01-15'),
          checksum,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.importFile.createMany({
      data: [
        {
          id: id(`import-file:${part.key}`),
          batchId,
          programId,
          fileRef: `seed/${part.key}.pdf`,
          originalName: `demo-${part.key}.pdf`,
          sizeBytes: 0n,
          checksum,
          status: 'confirmed',
          partNodeId: part.id,
          sourceVersionId: id(`source-version:${part.key}`),
          extractionMethod: 'ocr',
          qualityScore: 1,
          confirmedAt: validFrom,
        },
      ],
      skipDuplicates: true,
    });
  }

  // --- Households and voters: 20 houses and 60 electors per part -----------
  const households: Prisma.HouseholdCreateManyInput[] = [];
  const voters: Prisma.VoterCreateManyInput[] = [];
  let epicNumber = 1_000_000;
  for (const [partIndex, part] of parts.entries()) {
    let serial = 0;
    for (let h = 1; h <= 20; h += 1) {
      const section = h <= 10 ? 1 : 2;
      const station = section === 2 && part.auxStation ? part.auxStation : part.mainStation;
      const houseNo = `${partIndex + 1}-${h * 3}`;
      const householdId = id(`household:${part.key}:${h}`);
      const family = random.pick(FAMILY_NAMES);
      const street = random.pick(STREETS);
      households.push({
        id: householdId,
        partId: part.id,
        pollingStationId: station,
        houseKey: houseNo,
        displayAddress: `H NO ${houseNo}`,
        structuredAddress: {
          house_no: houseNo,
          street,
          area: part.key === 'part1' ? 'Demo Nagar' : 'Sample Colony',
          pin_code: part.key === 'part1' ? '500001' : '500002',
        },
        sourceVersionId: id(`source-version:${part.key}`),
      });
      const members = 3;
      const elderName = random.pick(MALE_NAMES);
      for (let m = 0; m < members; m += 1) {
        serial += 1;
        epicNumber += 1;
        const female = m === 1 || (m === 2 && random.next() < 0.5);
        const given = female ? random.pick(FEMALE_NAMES) : random.pick(MALE_NAMES);
        const relationType = m === 0 ? 'father' : female && m === 1 ? 'husband' : 'father';
        const relativeName =
          m === 0 ? `${random.pick(MALE_NAMES)} ${family}` : `${elderName} ${family}`;
        voters.push({
          id: id(`voter:${part.key}:${serial}`),
          programId,
          householdId,
          partId: part.id,
          pollingStationId: station,
          origin: 'official_import',
          sectionNo: section,
          serialNo: serial,
          sourceVoterId: `DMO${epicNumber}`,
          sourceData: {
            name: `${given} ${family}`,
            relationType,
            relativeName,
            houseNumber: houseNo,
            age: m === 0 ? random.int(45, 80) : m === 1 ? random.int(35, 70) : random.int(18, 34),
            gender: female ? 'female' : 'male',
          },
          sourceVersionId: id(`source-version:${part.key}`),
          importFileId: id(`import-file:${part.key}`),
        });
      }
    }
  }
  await prisma.household.createMany({ data: households, skipDuplicates: true });
  await prisma.voter.createMany({ data: voters, skipDuplicates: true });

  // --- Field definitions (spec v1.1) ----------------------------------------
  const field = (
    key: string,
    type: 'text' | 'number' | 'phone' | 'single_select',
    extra: Partial<{
      enabled: boolean;
      isRestricted: boolean;
      requiresConsent: boolean;
      legalBasis: string;
      options: object;
      purpose: string;
    }> = {},
  ) => ({
    id: id(`field:${key}`),
    programId,
    key,
    labelKey: `field.${key}`,
    appliesTo: 'voter' as const,
    type,
    purpose: extra.purpose ?? 'Keep the member’s details up to date for field work',
    enabled: extra.enabled ?? true,
    isRestricted: extra.isRestricted ?? false,
    requiresConsent: extra.requiresConsent ?? false,
    legalBasis: extra.legalBasis ?? null,
    options: extra.options,
  });
  await prisma.fieldDefinition.createMany({
    data: [
      field('name', 'text'),
      field('age', 'number'),
      field('gender', 'single_select', {
        options: [
          { value: 'female', labelKey: 'gender.female' },
          { value: 'male', labelKey: 'gender.male' },
          { value: 'third_gender', labelKey: 'gender.third_gender' },
        ],
      }),
      field('mobile_number', 'phone'),
      field('occupation', 'text'),
      field('additional_info', 'text'),
      field('caste_community', 'text', {
        isRestricted: true,
        requiresConsent: true,
        purpose: 'Optional, with the member’s consent (spec v1.1)',
        legalBasis:
          'DEVELOPMENT SEED ONLY: the legal review in spec §22 must be completed before production use',
      }),
      field('religion', 'text', {
        enabled: false,
        isRestricted: true,
        purpose: 'Not collected (restricted)',
      }),
      field('political_affiliation', 'text', {
        enabled: false,
        isRestricted: true,
        purpose: 'Not collected (restricted)',
      }),
    ],
    skipDuplicates: true,
  });

  // --- One volunteer-added member, with details as field values -------------
  const addedHousehold = id('household:part1:1');
  const addedMember = id('voter:part1:added-1');
  await prisma.voter.createMany({
    data: [
      {
        id: addedMember,
        programId,
        householdId: addedHousehold,
        partId: id('node:part1'),
        pollingStationId: id('node:ps1'),
        origin: 'volunteer_added',
      },
    ],
    skipDuplicates: true,
  });
  const collectedAt = new Date('2026-02-01T05:00:00Z');
  const value = (key: string, entityId: string, v: unknown) => ({
    id: id(`value:${entityId}:${key}`),
    entityType: 'voter' as const,
    entityId,
    fieldDefinitionId: id(`field:${key}`),
    value: v as object,
    sourceType: 'volunteer_collected' as const,
    collectedById: volunteerA,
    collectedAt,
  });
  await prisma.fieldValue.createMany({
    data: [
      value('name', addedMember, `${random.pick(FEMALE_NAMES)} Demoreddy`),
      value('age', addedMember, 19),
      value('gender', addedMember, 'female'),
      value('occupation', id('voter:part1:1'), random.pick(OCCUPATIONS)),
      value('mobile_number', id('voter:part1:1'), '+919999900101'),
    ],
    skipDuplicates: true,
  });

  // --- A few household locations, each with its consent ---------------------
  const located = [1, 2, 3].map((h) => ({ householdId: id(`household:part1:${h}`), h }));
  await prisma.consent.createMany({
    data: located.map(({ householdId, h }) => ({
      id: id(`consent:location:${h}`),
      subjectHouseholdId: householdId,
      purpose: 'household_location',
      noticeVersion: '2026.1',
      capturedMethod: 'in_person_verbal' as const,
      capturedById: volunteerA,
      capturedAt: collectedAt,
    })),
    skipDuplicates: true,
  });
  for (const { householdId, h } of located) {
    // Only the first run sets it; later runs find it already set.
    await prisma.household.updateMany({
      where: { id: householdId, locationConsentId: null },
      data: {
        locationLat: 17.385 + h * 0.001,
        locationLng: 78.4867 + h * 0.001,
        locationAccuracyM: 8,
        locationCapturedAt: collectedAt,
        locationConsentId: id(`consent:location:${h}`),
      },
    });
  }

  const [
    geographyNodes,
    users,
    householdCount,
    voterCount,
    fieldDefinitions,
    fieldValues,
    consents,
  ] = await Promise.all([
    prisma.geographyNode.count({ where: { programId } }),
    prisma.appUser.count({ where: { organizationId: orgId } }),
    prisma.household.count({ where: { part: { programId } } }),
    prisma.voter.count({ where: { programId } }),
    prisma.fieldDefinition.count({ where: { programId } }),
    prisma.fieldValue.count({ where: { fieldDefinition: { programId } } }),
    prisma.consent.count({
      where: { id: { in: located.map(({ h }) => id(`consent:location:${h}`)) } },
    }),
  ]);
  return {
    geographyNodes,
    users,
    households: householdCount,
    voters: voterCount,
    fieldDefinitions,
    fieldValues,
    consents,
  };
}
