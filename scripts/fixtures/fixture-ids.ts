// Stable, literal fixture UUIDs. Never gen_random_uuid() at seed time (spec §1.14).
// Naming scheme: entity-type prefix + sequential suffix, grouped by tree branch.
//
// This file is the canonical reference for test code (T4.x, T5.1's gate) to
// name fixture rows by identity rather than raw UUID strings — e.g.
// FIXTURE.users.foremanA1a, not '10000000-0000-0000-0000-000000000004'.

export const FIXTURE = {
  users: {
    admin: '10000000-0000-0000-0000-000000000001',
    consultantA: '10000000-0000-0000-0000-000000000002',
    siteManagerA1: '10000000-0000-0000-0000-000000000003', // deactivated
    foremanA1a: '10000000-0000-0000-0000-000000000004',
    foremanA1b: '10000000-0000-0000-0000-000000000005',
    siteManagerA2: '10000000-0000-0000-0000-000000000006',
    foremanA2a: '10000000-0000-0000-0000-000000000007',
    consultantB: '10000000-0000-0000-0000-000000000008',
    siteManagerB1: '10000000-0000-0000-0000-000000000009',
    foremanB1a: '10000000-0000-0000-0000-00000000000a',
    foremanB1b: '10000000-0000-0000-0000-00000000000b',
    consultantC: '10000000-0000-0000-0000-00000000000c', // deactivated, dead-chain branch
    foremanC1: '10000000-0000-0000-0000-00000000000d',
    unplacedBare: '10000000-0000-0000-0000-00000000000e', // role IS NULL, supervisor_id IS NULL
    foremanOrphanUnderUnplaced: '10000000-0000-0000-0000-00000000000f',
  },
  journal: {
    consultantANormal: '20000000-0000-0000-0000-000000000001',
    consultantARestricted: '20000000-0000-0000-0000-000000000002',
    siteManagerA1Normal: '20000000-0000-0000-0000-000000000003',
    siteManagerA1Restricted: '20000000-0000-0000-0000-000000000004',
    siteManagerA2Normal: '20000000-0000-0000-0000-000000000005',
    siteManagerA2Restricted: '20000000-0000-0000-0000-000000000006',
    foremanA1aNormalArabic: '20000000-0000-0000-0000-000000000007',
    foremanA1aRestrictedArabic: '20000000-0000-0000-0000-000000000008',
    foremanA1bNormal: '20000000-0000-0000-0000-000000000009',
    foremanA2aNormal: '20000000-0000-0000-0000-00000000000a', // the "competing higher-similarity journal" for T4.5
    foremanA2aRestricted: '20000000-0000-0000-0000-00000000000b',
    consultantBNormal: '20000000-0000-0000-0000-00000000000c',
    consultantBRestricted: '20000000-0000-0000-0000-00000000000d',
    siteManagerB1Normal: '20000000-0000-0000-0000-00000000000e',
    siteManagerB1Restricted: '20000000-0000-0000-0000-00000000000f',
    foremanB1aNormalArabic: '20000000-0000-0000-0000-000000000010',
    foremanB1aRestrictedArabic: '20000000-0000-0000-0000-000000000011',
    foremanB1bNormal: '20000000-0000-0000-0000-000000000012',
    foremanC1Normal: '20000000-0000-0000-0000-000000000013',
    foremanOrphanNormal: '20000000-0000-0000-0000-000000000014',
    foremanA1aTombstoned: '20000000-0000-0000-0000-000000000015',
  },
  wiki: {
    entryA1: '30000000-0000-0000-0000-000000000001', // owned by consultantA, normal
    entryA2: '30000000-0000-0000-0000-000000000002', // owned by foremanA1a, restricted
    entryB1: '30000000-0000-0000-0000-000000000003', // owned by siteManagerB1, normal
  },
  wikiVersion: {
    entryA1v1: '31000000-0000-0000-0000-000000000001', // the "equal similarity to journal" partner for T4.5
    entryA2v1: '31000000-0000-0000-0000-000000000002',
    entryB1v1: '31000000-0000-0000-0000-000000000003',
  },
  qaThread: {
    pumpPressureThread: '40000000-0000-0000-0000-000000000001', // question closely matches TEST_QUERY_VECTOR
    seedShipmentThread: '40000000-0000-0000-0000-000000000002', // unanswered, generic
  },
  qaAnswer: {
    pumpPressureAnswer: '41000000-0000-0000-0000-000000000001',
  },
  qaAnswerVersion: {
    pumpPressureAnswerV1: '42000000-0000-0000-0000-000000000001', // deliberately LOW raw similarity, relies on question boost
  },
} as const
