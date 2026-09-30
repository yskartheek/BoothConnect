import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:drift/drift.dart' hide isNull;
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';

import '../support/memory_secrets.dart';

// Synthetic data only.
const address = 'Synthetic Street 12, Demo Nagar';

HouseholdsCompanion household(String id) => HouseholdsCompanion.insert(
  id: id,
  partId: 'part-1',
  pollingStationId: 'station-1',
  displayAddress: address,
  houseKey: '12',
  origin: 'official_import',
  status: 'active',
);

void main() {
  late Directory dir;
  late MemorySecrets secrets;
  late LocalStore store;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('bc_db_test');
    secrets = MemorySecrets();
    store = LocalStore(
      directory: () async => dir,
      keys: DatabaseKeyStore(secrets),
      inBackground: false,
    );
  });
  tearDown(() async {
    await store.wipe();
    dir.deleteSync(recursive: true);
  });

  test('the key: 256 random bits, made once and kept', () async {
    final keys = DatabaseKeyStore(secrets);
    final key = await keys.readOrCreate();
    expect(key, matches(RegExp(r'^[0-9a-f]{64}$')));
    expect(secrets.values[DatabaseKeyStore.secretName], key);
    expect(await keys.readOrCreate(), key);
    // Another install gets another key.
    expect(await DatabaseKeyStore(MemorySecrets()).readOrCreate(), isNot(key));
    // A damaged stored key is replaced, not used.
    secrets.values[DatabaseKeyStore.secretName] = 'not-a-key';
    expect(await keys.readOrCreate(), matches(RegExp(r'^[0-9a-f]{64}$')));
  });

  test('the key bytes come from the random source', () async {
    final a = await DatabaseKeyStore(
      MemorySecrets(),
      random: Random(1),
    ).readOrCreate();
    final b = await DatabaseKeyStore(
      MemorySecrets(),
      random: Random(2),
    ).readOrCreate();
    expect(a, isNot(b));
  });

  test('every table is created', () async {
    final db = await store.open();
    final tables = await db
        .customSelect(
          "SELECT name FROM sqlite_master WHERE type = 'table' "
          "AND name NOT LIKE 'sqlite_%'",
        )
        .map((row) => row.read<String>('name'))
        .get();
    expect(tables.toSet(), {
      'field_definitions',
      'households',
      'voters',
      'field_values',
      'visits',
      'sync_meta',
      'pending_mutation',
    });
    expect(db.schemaVersion, 2);
  });

  test('data survives closing and reopening with the key', () async {
    var db = await store.open();
    await db.into(db.households).insert(household('h-1'));
    await db
        .into(db.syncMeta)
        .insert(SyncMetaCompanion.insert(key: 'cursor', value: 'c-1'));
    await db.close();

    store = LocalStore(
      directory: () async => dir,
      keys: DatabaseKeyStore(secrets),
      inBackground: false,
    );
    db = await store.open();
    final rows = await db.select(db.households).get();
    expect(rows.single.displayAddress, address);
    expect((await db.select(db.syncMeta).getSingle()).value, 'c-1');
  });

  test("the file can't be opened without the key", () async {
    final db = await store.open();
    await db.into(db.households).insert(household('h-1'));
    await db.close();
    final file = await store.file();

    // No SQLite header and no readable text: the whole file is encrypted.
    final bytes = file.readAsBytesSync();
    expect(
      ascii.decode(bytes.sublist(0, 15), allowInvalid: true),
      isNot('SQLite format 3'),
    );
    expect(latin1.decode(bytes).contains('Synthetic Street'), isFalse);

    // Without a key, SQLite sees no database.
    final plain = sqlite3.open(file.path);
    expect(
      () => plain.select('SELECT * FROM households'),
      throwsA(isA<SqliteException>()),
    );
    plain.close();

    // With another key, neither.
    final other = sqlite3.open(file.path);
    expect(
      () => LocalStore.unlock(other, 'ab' * 32),
      throwsA(isA<SqliteException>()),
    );
    other.close();

    // With the right key, the data is there.
    final right = sqlite3.open(file.path);
    LocalStore.unlock(right, secrets.values[DatabaseKeyStore.secretName]!);
    expect(
      right
          .select('SELECT display_address FROM households')
          .single['display_address'],
      address,
    );
    right.close();
  });

  test('a malformed key is refused before it reaches SQL', () {
    final raw = sqlite3.openInMemory();
    expect(
      () => LocalStore.unlock(raw, "00'; DROP TABLE x; --"),
      throwsArgumentError,
    );
    raw.close();
  });

  test('wipe removes the data and the key', () async {
    final db = await store.open();
    await db.into(db.households).insert(household('h-1'));
    await db
        .into(db.pendingMutations)
        .insert(
          PendingMutationsCompanion.insert(
            key: 'mutation-0001',
            type: 'visit.create',
            payload: '{}',
            createdAt: DateTime.utc(2026, 9, 29),
          ),
        );
    final file = await store.file();
    expect(file.existsSync(), isTrue);

    await store.wipe();
    // The old connection is closed, not left open on a deleted file.
    await expectLater(db.select(db.households).get(), throwsA(anything));
    expect(file.existsSync(), isFalse);
    expect(File('${file.path}-wal').existsSync(), isFalse);
    expect(secrets.values, isEmpty);

    // Opening again starts empty, with a new key.
    final fresh = await store.open();
    expect(await fresh.select(fresh.households).get(), isEmpty);
    expect(await fresh.select(fresh.pendingMutations).get(), isEmpty);
  });

  test('pending mutations keep their order, and a key is used once', () async {
    final db = await store.open();
    for (final key in ['mutation-b', 'mutation-a']) {
      await db
          .into(db.pendingMutations)
          .insert(
            PendingMutationsCompanion.insert(
              key: key,
              type: 'field.change',
              payload: '{}',
              createdAt: DateTime.utc(2026, 9, 29),
            ),
          );
    }
    final rows = await (db.select(
      db.pendingMutations,
    )..orderBy([(t) => OrderingTerm(expression: t.id)])).get();
    expect(rows.map((r) => r.key), ['mutation-b', 'mutation-a']);
    expect(rows.first.status, 'pending');
    expect(rows.first.attempts, 0);
    await expectLater(
      db
          .into(db.pendingMutations)
          .insert(
            PendingMutationsCompanion.insert(
              key: 'mutation-a',
              type: 'field.change',
              payload: '{}',
              createdAt: DateTime.utc(2026, 9, 29),
            ),
          ),
      throwsA(anything),
    );
  });

  test('lists of ids are stored as JSON', () async {
    final db = await store.open();
    await db
        .into(db.visits)
        .insert(
          VisitsCompanion.insert(
            clientId: 'visit-1',
            householdId: 'h-1',
            volunteerId: 'u-1',
            startedAt: DateTime.utc(2026, 9, 29, 10),
            outcome: 'completed',
            formVersion: '1',
            memberIdsMet: ['v-1', 'v-2'],
          ),
        );
    final visit = await db.select(db.visits).getSingle();
    expect(visit.memberIdsMet, ['v-1', 'v-2']);
    expect(visit.serverId, isNull);
  });

  group('migrations', () {
    test('run each step in order', () async {
      final ran = <int>[];
      await runMigrationSteps(_NoMigrator(), 1, 3, {
        2: (_) async => ran.add(2),
        3: (_) async => ran.add(3),
      });
      expect(ran, [2, 3]);
    });

    test('a missing step or a downgrade fails', () async {
      await expectLater(
        runMigrationSteps(_NoMigrator(), 1, 3, {2: (_) async {}}),
        throwsStateError,
      );
      await expectLater(
        runMigrationSteps(_NoMigrator(), 3, 2, const {}),
        throwsStateError,
      );
    });

    test('every version after 1 has a step', () {
      expect(AppDatabase.migrationSteps.keys, [2]);
    });

    test('1 → 2 adds the household to queued changes, keeping them', () async {
      // A version-2 database, taken back to version 1's shape, with a change
      // queued in it.
      var db = await store.open();
      await db
          .into(db.pendingMutations)
          .insert(
            PendingMutationsCompanion.insert(
              key: 'mutation-v1',
              type: 'visit.create',
              payload: '{"x":1}',
              createdAt: DateTime.utc(2026, 9, 29),
            ),
          );
      await db.customStatement('DROP INDEX pending_mutation_household');
      await db.customStatement(
        'ALTER TABLE pending_mutation DROP COLUMN household_id',
      );
      await db.customStatement('PRAGMA user_version = 1');
      await db.close();

      // The app opens it: the step runs.
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(secrets),
        inBackground: false,
      );
      db = await store.open();
      final row = await db.select(db.pendingMutations).getSingle();
      expect(row.key, 'mutation-v1');
      expect(row.payload, '{"x":1}');
      expect(row.householdId, isNull);
      final version = await db.customSelect('PRAGMA user_version').getSingle();
      expect(version.read<int>('user_version'), 2);
      final index = await db
          .customSelect(
            "SELECT name FROM sqlite_master WHERE type = 'index' "
            "AND name = 'pending_mutation_household'",
          )
          .get();
      expect(index, hasLength(1));
      // And the new column is usable.
      await db
          .into(db.pendingMutations)
          .insert(
            PendingMutationsCompanion.insert(
              key: 'mutation-v2',
              type: 'visit.create',
              payload: '{}',
              householdId: const Value('h-1'),
              createdAt: DateTime.utc(2026, 9, 30),
            ),
          );
    });
  });
}

class _NoMigrator implements Migrator {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
