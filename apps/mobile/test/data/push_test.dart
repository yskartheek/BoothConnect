import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/local/local_writes.dart';
import 'package:boothconnect_mobile/data/sync/push_repository.dart';
import 'package:boothconnect_mobile/data/sync/sync_repository.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/sync/sync_controller.dart';
import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_sync_api.dart';
import '../support/memory_secrets.dart';

// Synthetic data only.

/// A [Random] whose `nextDouble` is always [value].
class _Fixed implements Random {
  _Fixed(this.value);
  final double value;
  @override
  double nextDouble() => value;
  @override
  int nextInt(int max) => 0;
  @override
  bool nextBool() => false;
}

/// The server stores the batch, but the answer never reaches the phone.
class _LostAnswer extends FakeSyncApi {
  var lose = 1;

  @override
  Future<List<Map<String, dynamic>>> push(
    List<Map<String, Object?>> mutations, {
    required String idempotencyKey,
  }) async {
    final results = await super.push(mutations, idempotencyKey: idempotencyKey);
    if (lose-- > 0) throw offline;
    return results;
  }
}

/// Holds each push until [release].
class _SlowApi extends FakeSyncApi {
  final gate = Completer<void>();
  void release() => gate.complete();

  @override
  Future<List<Map<String, dynamic>>> push(
    List<Map<String, Object?>> mutations, {
    required String idempotencyKey,
  }) async {
    await gate.future;
    return super.push(mutations, idempotencyKey: idempotencyKey);
  }
}

class _SignedIn extends AuthController {
  @override
  AuthStatus build() => AuthStatus.signedIn;
}

class _SignedOut extends AuthController {
  @override
  AuthStatus build() => AuthStatus.signedOut;
}

Future<void> seed(AppDatabase db) async {
  await db
      .into(db.syncMeta)
      .insert(SyncMetaCompanion.insert(key: 'owner', value: 'u-1'));
  await db
      .into(db.households)
      .insert(
        HouseholdsCompanion.insert(
          id: 'h-1',
          partId: 'part-1',
          pollingStationId: 'station-1',
          displayAddress: '12/4 Synthetic Street',
          houseKey: '12/4',
          origin: 'official_import',
          status: 'active',
        ),
      );
  await db
      .into(db.voters)
      .insert(
        VotersCompanion.insert(
          id: 'v-1',
          householdId: 'h-1',
          partId: 'part-1',
          pollingStationId: 'station-1',
          origin: 'official_import',
          recordStatus: 'active',
          official: '{"name":"Synthetic One"}',
          previousVoterIds: const [],
        ),
      );
}

Future<String> visit(AppDatabase db, {String outcome = 'completed'}) =>
    db.recordVisit(
      householdId: 'h-1',
      outcome: outcome,
      startedAt: DateTime.utc(2026, 9, 30, 10),
      completedAt: DateTime.utc(2026, 9, 30, 10, 5),
    );

Future<void> change(AppDatabase db, String value, {int minute = 0}) =>
    db.changeField(
      entityType: 'voter',
      entityId: 'v-1',
      householdId: 'h-1',
      fieldKey: 'occupation',
      value: value,
      at: DateTime.utc(2026, 9, 30, 10, minute),
    );

Future<List<PendingMutationRow>> queued(AppDatabase db) => (db.select(
  db.pendingMutations,
)..orderBy([(t) => OrderingTerm(expression: t.id)])).get();

void main() {
  group('backoff', () {
    test('doubles from 2 seconds, at most 5 minutes, with jitter', () {
      Duration low(int n) => backoff(n, _Fixed(0));
      Duration high(int n) => backoff(n, _Fixed(0.999999));
      expect(low(1), const Duration(seconds: 1));
      expect(high(1), const Duration(seconds: 2));
      expect(low(2), const Duration(seconds: 2));
      expect(high(3), const Duration(seconds: 8));
      expect(high(8), const Duration(seconds: 256));
      expect(high(9), const Duration(minutes: 5));
      expect(low(9), const Duration(seconds: 150));
      expect(high(1000), const Duration(minutes: 5));
      expect(low(0), const Duration(seconds: 1));
      // Each phone waits a different time.
      final waits = {
        for (var i = 0; i < 20; i++) backoff(4, Random(i)).inMilliseconds,
      };
      expect(waits.length, greaterThan(10));
      expect(
        waits,
        everyElement(
          allOf(greaterThanOrEqualTo(8000), lessThanOrEqualTo(16000)),
        ),
      );
    });
  });

  group('the push queue', () {
    // A real clock: Drift on real files.
    late Directory dir;
    late MemorySecrets secrets;
    late LocalStore store;
    late AppDatabase db;
    late FakeSyncApi api;
    var now = DateTime.utc(2026, 9, 30, 12);

    PushRepository repository([FakeSyncApi? with_]) =>
        PushRepository(db, with_ ?? api, random: _Fixed(0));

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_push_test');
      secrets = MemorySecrets();
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(secrets),
        inBackground: false,
      );
      db = await store.open();
      api = FakeSyncApi();
      now = DateTime.utc(2026, 9, 30, 12);
      await seed(db);
    });
    tearDown(() async {
      await store.wipe();
      dir.deleteSync(recursive: true);
    });

    test('uploads oldest first, then clears what the server stored', () async {
      final clientId = await visit(db);
      await change(db, 'Teacher');
      final keys = [for (final m in await queued(db)) m.key];

      final result = await repository().pushDue(now: () => now);
      expect(result.uploaded, 2);
      expect(result.error, isNull);

      final sent = api.pushed.single;
      expect([for (final m in sent) m['key']], keys);
      // The request's key is made from exactly this batch.
      expect(api.keys.single, batchKey(sent));
      expect(
        [for (final m in sent) m['type']],
        ['visit.create', 'field.change'],
      );
      // The phone's own keys stay on the phone.
      final fieldPayload = sent.last['payload']! as Map<String, dynamic>;
      expect(fieldPayload, isNot(contains('_fieldValueId')));
      expect(fieldPayload['value'], 'Teacher');
      expect(
        (sent.first['payload']! as Map<String, dynamic>)['clientId'],
        clientId,
      );

      expect(await queued(db), isEmpty);
      // The visit has its server id; the household shows Uploaded.
      final row = await db.select(db.visits).getSingle();
      expect(row.serverId, 'server-${keys.first}');
      final summary = (await db.watchHouseholdSummaries().first).single;
      expect(summary.sync, HouseholdSync.uploaded);
      // The value has the server's id.
      final value = await db.select(db.fieldValues).getSingle();
      expect(value.id, 'server-fv-${keys.last}');
      expect(value.isCurrent, isTrue);
    });

    test(
      'a pull afterwards updates the phone’s copy, not a second one',
      () async {
        await change(db, 'Teacher');
        final key = (await queued(db)).single.key;
        await repository().pushDue(now: () => now);

        await db
            .into(db.syncMeta)
            .insert(SyncMetaCompanion.insert(key: 'cursor', value: 'c-1'));
        final pull = FakeSyncApi([
          syncPage(
            cursor: 'c-2',
            fieldValues: [
              {
                'id': 'server-fv-$key',
                'entityType': 'voter',
                'entityId': 'v-1',
                'fieldKey': 'occupation',
                'value': 'Teacher',
                'sourceType': 'volunteer_collected',
                'collectedBy': {'id': 'u-1', 'name': 'Demo Volunteer'},
                'collectedAt': '2026-09-30T10:00:00.000Z',
                'supersedesId': null,
                'carriedFromId': null,
                'isCurrent': true,
                'conflictWithId': null,
              },
            ],
          ),
        ]);
        await SyncRepository(db, pull).pull();
        final values = await db.select(db.fieldValues).get();
        expect(values.single.id, 'server-fv-$key');
        expect(values.single.collectedByName, 'Demo Volunteer');
      },
    );

    test(
      'an edit made during an upload is sent with the server’s id',
      () async {
        await change(db, 'Teacher');
        // The first change is on its way when the volunteer edits again:
        // the second is based on the phone's copy of the first.
        await db.customStatement(
          "UPDATE pending_mutation SET status = 'syncing'",
        );
        await change(db, 'Head teacher', minute: 5);
        final first = (await queued(db)).first;
        final local = (jsonDecode(
          first.payload,
        ) as Map<String, dynamic>)['_fieldValueId'];
        expect(
          (jsonDecode((await queued(db)).last.payload)
              as Map<String, dynamic>)['baseVersion'],
          local,
        );

        // (The app closed mid-upload; both are due now.)
        final result = await repository().pushDue(now: () => now);
        expect(result.uploaded, 2);
        // Two batches: the second waited for the first's server id.
        expect(api.pushed.map((b) => b.length), [1, 1]);
        final second =
            api.pushed.last.single['payload']! as Map<String, dynamic>;
        expect(second['baseVersion'], 'server-fv-${first.key}');
        final values = await (db.select(
          db.fieldValues,
        )..orderBy([(t) => OrderingTerm(expression: t.collectedAt)])).get();
        expect(values.first.id, 'server-fv-${first.key}');
        expect(values.last.supersedesId, 'server-fv-${first.key}');
      },
    );

    test('a later edit is based on the server’s id', () async {
      await change(db, 'Teacher');
      final first = (await queued(db)).single;
      await repository().pushDue(now: () => now);
      // Uploaded; the pull hasn't run yet.
      await change(db, 'Head teacher', minute: 5);
      await repository().pushDue(now: () => now);
      final payload =
          api.pushed.last.single['payload']! as Map<String, dynamic>;
      expect(payload['baseVersion'], 'server-fv-${first.key}');
    });

    test('a conflict stays on the phone for the volunteer to choose', () async {
      await change(db, 'Teacher');
      final key = (await queued(db)).single.key;
      api.answer = (m) => {
        'status': 'conflict',
        'result': {
          'status': 'conflict',
          'fieldValueId': 'server-fv-mine',
          'conflictWithId': 'server-fv-theirs',
        },
      };
      final result = await repository().pushDue(now: () => now);
      expect(result.conflicts, 1);

      final m = (await queued(db)).single;
      expect(m.key, key);
      expect(m.status, 'conflict');
      expect(m.lastError, 'CONFLICT');
      final value = await db.select(db.fieldValues).getSingle();
      expect(value.id, 'server-fv-mine');
      expect(value.conflictWithId, 'server-fv-theirs');
      final summary = (await db.watchHouseholdSummaries().first).single;
      expect(summary.sync, HouseholdSync.chooseValue);

      // Not sent again.
      await repository().pushDue(now: () => now);
      expect(api.pushed, hasLength(1));
    });

    test('each request has an Idempotency-Key made from what it sends', () {
      final a = [
        {
          'key': 'k-1',
          'type': 'visit.create',
          'payload': {'x': 1},
        },
      ];
      final b = [
        {
          'key': 'k-1',
          'type': 'visit.create',
          'payload': {'x': 2},
        },
      ];
      expect(batchKey(a), batchKey([...a]));
      expect(batchKey(a), isNot(batchKey(b)));
      // The API's rule: 8–128 letters, digits, "-" or "_".
      expect(batchKey(a), matches(RegExp(r'^push-[0-9a-f]{64}$')));
    });

    test('an edit after a change was sent is a change of its own', () async {
      await change(db, 'Teacher');
      api.pushErrors.add(offline);
      await repository().pushDue(now: () => now);
      // Sent once (the answer never came): the server may have it under
      // its key, so the next edit doesn't change it.
      await change(db, 'Head teacher', minute: 5);
      final all = await queued(db);
      expect(all, hasLength(2));
      expect(
        (jsonDecode(all.first.payload) as Map<String, dynamic>)['value'],
        'Teacher',
      );
    });

    test('a refused change waits for Upload now, with no retry time', () async {
      await visit(db);
      api.pushErrors.add(offline);
      await repository().pushDue(now: () => now);
      expect((await queued(db)).single.nextAttemptAt, isNotNull);
      now = now.add(const Duration(minutes: 1));
      api.answer = (m) => {'status': 'rejected', 'code': 'UNPROCESSABLE'};
      await repository().pushDue(now: () => now);
      final m = (await queued(db)).single;
      expect((m.status, m.nextAttemptAt), ('failed', null));
      expect(await repository().nextAttemptAt(), isNull);
    });

    test('a refused change is kept with the reason, until retried', () async {
      await visit(db);
      api.answer = (m) => {'status': 'rejected', 'code': 'VALIDATION_FAILED'};
      final result = await repository().pushDue(now: () => now);
      expect(result.failed, 1);
      final m = (await queued(db)).single;
      expect(m.status, 'failed');
      expect(m.lastError, 'VALIDATION_FAILED');
      expect(m.attempts, 1);

      // Not retried by itself.
      await repository().pushDue(now: () => now);
      expect(api.pushed, hasLength(1));

      // Upload now: sent again (the server has been fixed, say).
      api.answer = FakeSyncApi.applied;
      expect(await repository().retryNow(), 1);
      await repository().pushDue(now: () => now);
      expect(api.pushed, hasLength(2));
      expect(await queued(db), isEmpty);
    });

    test('offline: waits, backing off, then sends', () async {
      await visit(db);
      api.pushErrors.addAll([offline, offline]);

      final first = await repository().pushDue(now: () => now);
      expect(first.error?.isNetwork, isTrue);
      var m = (await queued(db)).single;
      expect(m.status, 'pending');
      expect(m.attempts, 1);
      expect(m.lastError, 'NETWORK');
      // _Fixed(0): half of 2 seconds.
      expect(
        m.nextAttemptAt!.isAtSameMomentAs(now.add(const Duration(seconds: 1))),
        isTrue,
      );
      expect(
        (await repository().nextAttemptAt())!.isAtSameMomentAs(
          now.add(const Duration(seconds: 1)),
        ),
        isTrue,
      );

      // Not due yet: nothing is sent.
      await repository().pushDue(now: () => now);
      expect(api.pushed, hasLength(1));

      now = now.add(const Duration(seconds: 1));
      await repository().pushDue(now: () => now);
      m = (await queued(db)).single;
      expect(m.attempts, 2);
      expect(
        m.nextAttemptAt!.isAtSameMomentAs(now.add(const Duration(seconds: 2))),
        isTrue,
      );

      // Retry now skips the wait.
      await repository().retryNow();
      expect((await queued(db)).single.nextAttemptAt, isNull);
      await repository().pushDue(now: () => now);
      expect(await queued(db), isEmpty);
      expect(await repository().nextAttemptAt(), isNull);
    });

    test('an odd change on the phone doesn’t stop the batch', () async {
      // Stored without the client id (an older or damaged row).
      await db
          .into(db.pendingMutations)
          .insert(
            PendingMutationsCompanion.insert(
              key: 'mutation-odd',
              type: 'visit.create',
              payload: '{}',
              createdAt: DateTime.utc(2026, 9, 30),
            ),
          );
      await visit(db);
      final result = await repository().pushDue(now: () => now);
      expect(result.uploaded, 2);
      expect(await queued(db), isEmpty);
      expect((await db.select(db.visits).getSingle()).serverId, isNotNull);
    });

    test('a server error answers like offline: retried later', () async {
      await visit(db);
      api.pushErrors.add(const ApiError('INTERNAL_ERROR', status: 503));
      final result = await repository().pushDue(now: () => now);
      expect(result.error?.code, 'INTERNAL_ERROR');
      final m = (await queued(db)).single;
      expect((m.status, m.lastError), ('pending', 'INTERNAL_ERROR'));
    });

    test('a change the answer leaves out is retried later', () async {
      await visit(db);
      await change(db, 'Teacher');
      final keys = [for (final m in await queued(db)) m.key];
      final partial = _Partial(keys.last);
      await PushRepository(
        db,
        partial,
        random: _Fixed(0),
      ).pushDue(now: () => now);
      final m = (await queued(db)).single;
      expect(m.key, keys.last);
      expect((m.status, m.attempts), ('pending', 1));
      expect(m.nextAttemptAt, isNotNull);
    });

    test('sent twice (the answer was lost), stored once', () async {
      await visit(db);
      final lost = _LostAnswer();
      final repo = PushRepository(db, lost, random: _Fixed(0));
      await repo.pushDue(now: () => now);
      expect(await queued(db), hasLength(1));
      expect(lost.stored, hasLength(1));

      now = now.add(const Duration(minutes: 1));
      await repo.pushDue(now: () => now);
      expect(lost.pushed, hasLength(2));
      // The same keys both times, the request's and the change's: the
      // server answered from its record.
      expect(lost.pushed.first.single['key'], lost.pushed.last.single['key']);
      expect(lost.keys.first, lost.keys.last);
      expect(lost.stored, hasLength(1));
      expect(await queued(db), isEmpty);
      expect((await db.select(db.visits).getSingle()).serverId, isNotNull);
    });

    test(
      'left mid-upload (app closed), sent again with the same key',
      () async {
        await visit(db);
        final key = (await queued(db)).single.key;
        await db.customStatement(
          "UPDATE pending_mutation SET status = 'syncing'",
        );
        await repository().pushDue(now: () => now);
        expect(api.pushed.single.single['key'], key);
        expect(await queued(db), isEmpty);
      },
    );

    test('many changes go in batches, in order', () async {
      for (var i = 0; i < 120; i++) {
        await visit(db);
      }
      final keys = [for (final m in await queued(db)) m.key];
      expect(keys, hasLength(120));

      final result = await repository().pushDue(now: () => now);
      expect(result.uploaded, 120);
      expect(api.pushed.map((b) => b.length), [50, 50, 20]);
      expect([for (final b in api.pushed) ...b.map((m) => m['key'])], keys);
    });

    test('a chain of edits goes one link per batch', () async {
      for (var i = 0; i < 3; i++) {
        await change(db, 'Job $i', minute: i);
        // Each edit made while the previous one was uploading.
        await db.customStatement(
          "UPDATE pending_mutation SET status = 'syncing'",
        );
      }
      await repository().pushDue(now: () => now);
      expect(api.pushed.map((b) => b.length), [1, 1, 1]);
      expect(await queued(db), isEmpty);
    });

    test('the queue survives the app closing', () async {
      await visit(db);
      final key = (await queued(db)).single.key;
      await db.close();

      // The app opens again: same file, same key.
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(secrets),
        inBackground: false,
      );
      db = await store.open();
      expect((await queued(db)).single.key, key);
      await repository().pushDue(now: () => now);
      expect(api.pushed.single.single['key'], key);
      expect(await queued(db), isEmpty);
    });
  });

  group('the sync controller', () {
    late Directory dir;
    late LocalStore store;
    late AppDatabase db;

    ProviderContainer containerWith(FakeSyncApi api, {bool signedIn = true}) {
      final container = ProviderContainer(
        overrides: [
          localStoreProvider.overrideWithValue(store),
          syncApiProvider.overrideWithValue(api),
          authProvider.overrideWith(signedIn ? _SignedIn.new : _SignedOut.new),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_push_controller_test');
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(MemorySecrets()),
        inBackground: false,
      );
      db = await store.open();
      await seed(db);
      // A delta pull (not a snapshot): the cache stays.
      await db
          .into(db.syncMeta)
          .insert(SyncMetaCompanion.insert(key: 'cursor', value: 'c-1'));
    });
    tearDown(() async {
      await store.wipe();
      dir.deleteSync(recursive: true);
    });

    test('one push at a time: a second call joins the first', () async {
      await visit(db);
      final api = _SlowApi();
      final container = containerWith(api);
      final sync = container.read(syncControllerProvider.notifier);
      final a = sync.pushNow();
      final b = sync.pushNow();
      expect(identical(a, b), isTrue);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(container.read(syncControllerProvider).uploading, isTrue);
      var idle = false;
      unawaited(sync.whenIdle().then((_) => idle = true));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(idle, isFalse);

      api.release();
      await a;
      await Future<void>.delayed(Duration.zero);
      expect(idle, isTrue);
      expect(api.pushed, hasLength(1));
      expect(container.read(syncControllerProvider).uploading, isFalse);
    });

    test('a pull finishing during an upload keeps "uploading"', () async {
      await visit(db);
      final api = _SlowApi();
      final container = containerWith(api);
      final sync = container.read(syncControllerProvider.notifier);
      final push = sync.pushNow();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await sync.pullNow();
      final state = container.read(syncControllerProvider);
      expect(state.lastPullAt, isNotNull);
      expect(state.uploading, isTrue);
      api.release();
      await push;
      expect(container.read(syncControllerProvider).uploading, isFalse);
    });

    test('back online, a change waiting for its next try goes now', () async {
      await visit(db);
      await visit(db);
      final rows = await queued(db);
      // One waiting an hour (long offline), one refused by the server.
      await (db.update(
        db.pendingMutations,
      )..where((t) => t.id.equals(rows.first.id))).write(
        PendingMutationsCompanion(
          nextAttemptAt: Value(DateTime.now().add(const Duration(hours: 1))),
        ),
      );
      await (db.update(db.pendingMutations)
            ..where((t) => t.id.equals(rows.last.id)))
          .write(const PendingMutationsCompanion(status: Value('failed')));
      final api = FakeSyncApi();
      final container = containerWith(api);
      await container.read(syncControllerProvider.notifier).syncNow();
      expect(api.pushed.single.single['key'], rows.first.key);
      // The refused one waits for Upload now.
      expect((await queued(db)).single.status, 'failed');
    });

    test('sync uploads first, then downloads', () async {
      await visit(db);
      final api = FakeSyncApi();
      final container = containerWith(api);
      await container.read(syncControllerProvider.notifier).syncNow();
      expect(api.pushed, hasLength(1));
      expect(api.calls, ['c-1']);
      expect(await queued(db), isEmpty);
    });

    test('signed out: nothing is uploaded', () async {
      await visit(db);
      final api = FakeSyncApi();
      final container = containerWith(api, signedIn: false);
      expect(
        await container.read(syncControllerProvider.notifier).pushNow(),
        isNull,
      );
      expect(api.pushed, isEmpty);
    });

    test('offline: retried by itself when the wait is over', () async {
      await visit(db);
      final api = FakeSyncApi()..pushErrors.add(offline);
      final container = containerWith(api);
      final result = await container
          .read(syncControllerProvider.notifier)
          .pushNow();
      expect(result!.error!.isNetwork, isTrue);
      expect(api.pushed, hasLength(1));
      // The first wait is 1–2 seconds.
      await Future<void>.delayed(const Duration(milliseconds: 2300));
      await container.read(syncControllerProvider.notifier).whenIdle();
      expect(api.pushed, hasLength(2));
      expect(await queued(db), isEmpty);
    });

    test('Upload now sends refused changes again', () async {
      await visit(db);
      final api = FakeSyncApi()
        ..answer = (m) => {'status': 'rejected', 'code': 'UNPROCESSABLE'};
      final container = containerWith(api);
      final sync = container.read(syncControllerProvider.notifier);
      await sync.pushNow();
      expect((await queued(db)).single.status, 'failed');

      api.answer = FakeSyncApi.applied;
      final result = await sync.retryUploads();
      expect(result!.uploaded, 1);
      expect(await queued(db), isEmpty);
    });
  });
}

/// Answers for every change but [skip].
class _Partial extends FakeSyncApi {
  _Partial(this.skip);
  final String skip;

  @override
  Future<List<Map<String, dynamic>>> push(
    List<Map<String, Object?>> mutations, {
    required String idempotencyKey,
  }) async => [
    for (final r in await super.push(mutations, idempotencyKey: idempotencyKey))
      if (r['key'] != skip) r,
  ];
}
