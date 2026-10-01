import 'dart:convert';
import 'dart:io';

import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/sync/sync_repository.dart';
import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_sync_api.dart';
import '../support/memory_secrets.dart';

// Synthetic records only, shaped like the API's SyncPage.
Map<String, dynamic> household(
  String id, {
  String address = 'Synthetic Street',
  String status = 'active',
}) => {
  'id': id,
  'partId': 'part-1',
  'pollingStationId': 'station-1',
  'displayAddress': address,
  'houseKey': id.replaceAll('h-', ''),
  'structuredAddress': {'houseNumber': id},
  'location': {
    'lat': 17.4,
    'lng': 78.5,
    'accuracyM': 12,
    'capturedAt': '2026-09-01T05:00:00.000Z',
  },
  'origin': 'official_import',
  'status': status,
};

Map<String, dynamic> voter(
  String id,
  String householdId, {
  int serial = 1,
  String status = 'active',
}) => {
  'id': id,
  'householdId': householdId,
  'partId': 'part-1',
  'pollingStationId': 'station-1',
  'origin': 'official_import',
  'recordStatus': status,
  'sectionNo': 1,
  'serialNo': serial,
  'epicNumber': 'TST${1000000 + serial}',
  'official': {'name': 'Synthetic Person $serial', 'age': 30 + serial},
  'previousVoterIds': <String>[],
};

Map<String, dynamic> fieldValue(String id, String voterId, Object value) => {
  'id': id,
  'entityType': 'voter',
  'entityId': voterId,
  'fieldKey': 'occupation',
  'value': value,
  'sourceType': 'volunteer_collected',
  'collectedBy': {'id': 'u-1', 'name': 'Test Volunteer'},
  'collectedAt': '2026-09-02T06:00:00.000Z',
  'supersedesId': null,
  'carriedFromId': null,
  'isCurrent': true,
  'conflictWithId': null,
};

Map<String, dynamic> visit(String id, String clientId, String householdId) => {
  'id': id,
  'clientId': clientId,
  'householdId': householdId,
  'volunteerId': 'u-1',
  'startedAt': '2026-09-03T07:00:00.000Z',
  'completedAt': '2026-09-03T07:10:00.000Z',
  'outcome': 'completed',
  'formVersion': '1',
  'notes': null,
  'correctsVisitId': null,
  'memberIdsMet': ['v-1'],
};

const definition = {
  'id': 'fd-1',
  'key': 'occupation',
  'labelKey': 'field.occupation',
  'appliesTo': 'voter',
  'type': 'text',
  'options': null,
  'isRestricted': false,
  'requiresConsent': false,
  'enabled': true,
  'purpose': 'Outreach',
};

/// A two-page full snapshot: 3 households, 2 voters, a value, a visit.
List<Object> snapshot() => [
  syncPage(
    cursor: 'snap-p2',
    reset: true,
    hasMore: true,
    fieldDefinitions: [definition],
    households: [household('h-1'), household('h-2'), household('h-3')],
  ),
  syncPage(
    cursor: 'c-1',
    reset: true,
    voters: [voter('v-1', 'h-1'), voter('v-2', 'h-1', serial: 2)],
    fieldValues: [fieldValue('fv-1', 'v-1', 'Farmer')],
    visits: [visit('visit-1', 'client-1', 'h-1')],
  ),
];

void main() {
  late Directory dir;
  late LocalStore store;
  late AppDatabase db;

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('bc_sync_test');
    store = LocalStore(
      directory: () async => dir,
      keys: DatabaseKeyStore(MemorySecrets()),
      inBackground: false,
    );
    db = await store.open();
  });
  tearDown(() async {
    await store.wipe();
    dir.deleteSync(recursive: true);
  });

  Future<int> count(TableInfo<Table, Object?> table) async =>
      (await db.select(table).get()).length;

  Future<String?> meta(String key) async => (await (db.select(
    db.syncMeta,
  )..where((t) => t.key.equals(key))).getSingleOrNull())?.value;

  test('the first pull fills the database, page by page', () async {
    final api = FakeSyncApi(snapshot());
    final result = await SyncRepository(
      db,
      api,
    ).pull(now: () => DateTime.utc(2026, 9, 30, 8));

    expect(api.calls, [null, 'snap-p2']);
    expect(result.pages, 2);
    expect(await count(db.households), 3);
    expect(await count(db.voters), 2);
    expect(await count(db.fieldValues), 1);
    expect(await count(db.fieldDefinitions), 1);
    expect(await count(db.visits), 1);
    expect(await meta(SyncRepository.cursorKey), 'c-1');
    expect(await meta(SyncRepository.snapshotKey), isNull);
    expect(
      await SyncRepository(db, api).lastPullAt(),
      DateTime.utc(2026, 9, 30, 8),
    );

    // The API's JSON, mapped to columns.
    final h1 = await (db.select(
      db.households,
    )..where((t) => t.id.equals('h-1'))).getSingle();
    expect(h1.displayAddress, 'Synthetic Street');
    expect(h1.latitude, 17.4);
    expect(h1.accuracyM, 12);
    expect(h1.locationCapturedAt!.toUtc(), DateTime.utc(2026, 9, 1, 5));
    expect(jsonDecode(h1.structuredAddress!), {'houseNumber': 'h-1'});
    final v1 = await (db.select(
      db.voters,
    )..where((t) => t.id.equals('v-1'))).getSingle();
    expect(jsonDecode(v1.official), {'name': 'Synthetic Person 1', 'age': 31});
    final value = await db.select(db.fieldValues).getSingle();
    expect(jsonDecode(value.value), 'Farmer');
    expect(value.collectedByName, 'Test Volunteer');
    final visitRow = await db.select(db.visits).getSingle();
    expect(visitRow.clientId, 'client-1');
    expect(visitRow.serverId, 'visit-1');
    expect(visitRow.memberIdsMet, ['v-1']);
  });

  test('a delta pull updates only the changed rows', () async {
    await SyncRepository(db, FakeSyncApi(snapshot())).pull();
    final before = {
      for (final h in await db.select(db.households).get()) h.id: h,
    };

    final api = FakeSyncApi([
      syncPage(
        cursor: 'c-2',
        households: [
          household('h-2', address: 'Synthetic Street, corrected'),
          household('h-4'),
        ],
        fieldValues: [fieldValue('fv-2', 'v-2', 'Teacher')],
      ),
    ]);
    await SyncRepository(db, api).pull();

    expect(api.calls, ['c-1']);
    final after = {
      for (final h in await db.select(db.households).get()) h.id: h,
    };
    expect(after.keys, containsAll(['h-1', 'h-2', 'h-3', 'h-4']));
    expect(after['h-2']!.displayAddress, 'Synthetic Street, corrected');
    // Rows not in the delta are exactly as they were.
    expect(after['h-1'], before['h-1']);
    expect(after['h-3'], before['h-3']);
    expect(await count(db.voters), 2);
    expect(await count(db.fieldValues), 2);
    expect(await meta(SyncRepository.cursorKey), 'c-2');
  });

  test(
    'a new snapshot replaces the cache, keeping visits not yet uploaded',
    () async {
      await SyncRepository(db, FakeSyncApi(snapshot())).pull();
      // A visit recorded on the phone, not pushed yet: no server id.
      await db
          .into(db.visits)
          .insert(
            VisitsCompanion.insert(
              clientId: 'client-local',
              householdId: 'h-2',
              volunteerId: 'u-1',
              startedAt: DateTime.utc(2026, 9, 30),
              outcome: 'no_one_available',
              formVersion: '1',
              memberIdsMet: const [],
            ),
          );

      // The API starts over (e.g. the volunteer's booths changed).
      await SyncRepository(
        db,
        FakeSyncApi([
          syncPage(cursor: 'c-9', reset: true, households: [household('h-5')]),
        ]),
      ).pull();

      expect((await db.select(db.households).get()).map((h) => h.id), ['h-5']);
      expect(await count(db.voters), 0);
      expect(await count(db.fieldValues), 0);
      expect((await db.select(db.visits).get()).map((v) => v.clientId), [
        'client-local',
      ]);
    },
  );

  test('an interrupted snapshot goes on where it stopped', () async {
    final pages = snapshot();
    // Offline after the first page.
    final api = FakeSyncApi([pages[0], offline]);
    await expectLater(SyncRepository(db, api).pull(), throwsA(isA<ApiError>()));
    expect(await count(db.households), 3);
    expect(await meta(SyncRepository.cursorKey), 'snap-p2');
    expect(await meta(SyncRepository.snapshotKey), '1');

    // Back online: the second page (still reset) doesn't clear the first.
    final resumed = FakeSyncApi([pages[1]]);
    await SyncRepository(db, resumed).pull();
    expect(resumed.calls, ['snap-p2']);
    expect(await count(db.households), 3);
    expect(await count(db.voters), 2);
    expect(await meta(SyncRepository.snapshotKey), isNull);
  });

  test('a page that can’t be applied changes nothing', () async {
    await SyncRepository(db, FakeSyncApi(snapshot())).pull();
    final broken = household('h-2', address: 'Changed');
    broken.remove('houseKey');
    final api = FakeSyncApi([
      syncPage(cursor: 'c-2', households: [household('h-9'), broken]),
    ]);
    await expectLater(SyncRepository(db, api).pull(), throwsA(anything));

    expect(await count(db.households), 3);
    final h2 = await (db.select(
      db.households,
    )..where((t) => t.id.equals('h-2'))).getSingle();
    expect(h2.displayAddress, 'Synthetic Street');
    // The same page is asked for again next time.
    expect(await meta(SyncRepository.cursorKey), 'c-1');
  });

  test('a new snapshot whose first page fails keeps the old data', () async {
    await SyncRepository(db, FakeSyncApi(snapshot())).pull();
    final broken = household('h-8');
    broken.remove('houseKey');
    // The cache is cleared before the page is written: all or nothing.
    await expectLater(
      SyncRepository(
        db,
        FakeSyncApi([
          syncPage(cursor: 'c-9', reset: true, households: [broken]),
        ]),
      ).pull(),
      throwsA(anything),
    );
    expect(await count(db.households), 3);
    expect(await count(db.voters), 2);
    expect(await meta(SyncRepository.cursorKey), 'c-1');
    expect(await meta(SyncRepository.snapshotKey), isNull);
  });

  test('values whose consent was withdrawn are removed', () async {
    await SyncRepository(db, FakeSyncApi(snapshot())).pull();
    await SyncRepository(
      db,
      FakeSyncApi([
        syncPage(cursor: 'c-2', removedFieldValueIds: ['fv-1']),
      ]),
    ).pull();
    expect(await count(db.fieldValues), 0);
  });

  test('restricted details are never kept on the phone', () async {
    await SyncRepository(db, FakeSyncApi(snapshot())).pull();
    final caste = {
      ...fieldValue('fv-caste', 'v-1', 'Synthetic community'),
      'fieldKey': 'caste_community',
    };
    await SyncRepository(
      db,
      FakeSyncApi([
        syncPage(
            cursor: 'c-2',
            fieldDefinitions: [
              {
                ...definition,
                'id': 'fd-caste',
                'key': 'caste_community',
                'isRestricted': true,
                'requiresConsent': true,
              },
            ],
            fieldValues: [caste],
          )
          ..['conflicts'] = [
            {
              'entityType': 'voter',
              'entityId': 'v-1',
              'fieldKey': 'caste_community',
              'values': [
                {...caste, 'id': 'fv-caste-2', 'conflictWithId': 'fv-caste'},
                caste,
              ],
            },
          ],
      ]),
    ).pull();
    final keys = (await db.select(db.fieldValues).get()).map((v) => v.fieldKey);
    expect(keys, ['occupation']);
  });

  test('the owner is kept across pulls and snapshots', () async {
    final repository = SyncRepository(db, FakeSyncApi(snapshot()));
    expect(await repository.owner(), isNull);
    await repository.setOwner('u-1');
    await repository.pull();
    expect(await repository.owner(), 'u-1');
  });

  group('screens read the local database', () {
    test('households still on the roll, by house number', () async {
      await SyncRepository(
        db,
        FakeSyncApi([
          syncPage(
            cursor: 'c-1',
            reset: true,
            households: [
              household('h-3'),
              household('h-1'),
              household('h-2', status: 'removed'),
            ],
          ),
        ]),
      ).pull();
      final list = await db.watchHouseholds().first;
      expect(list.map((h) => h.id), ['h-1', 'h-3']);
    });

    test('a household’s active members in roll order, updating live', () async {
      await SyncRepository(
        db,
        FakeSyncApi([
          syncPage(
            cursor: 'c-1',
            reset: true,
            households: [household('h-1')],
            voters: [
              voter('v-2', 'h-1', serial: 2),
              voter('v-1', 'h-1'),
              voter('v-3', 'h-1', serial: 3, status: 'deleted'),
            ],
          ),
        ]),
      ).pull();
      final members = db.watchMembers('h-1');
      expect((await members.first).map((v) => v.id), ['v-1', 'v-2']);

      // A pull adds a member: the watch sees it.
      final next = expectLater(
        members.map((list) => list.map((v) => v.id).toList()),
        emitsThrough(['v-1', 'v-2', 'v-4']),
      );
      await SyncRepository(
        db,
        FakeSyncApi([
          syncPage(cursor: 'c-2', voters: [voter('v-4', 'h-1', serial: 4)]),
        ]),
      ).pull();
      await next;
      expect((await db.watchHousehold('h-1').first)!.id, 'h-1');
    });
  });
}
