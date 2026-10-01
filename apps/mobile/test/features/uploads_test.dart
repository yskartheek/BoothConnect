import 'dart:convert';
import 'dart:io';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/local/local_writes.dart';
import 'package:boothconnect_mobile/data/sync/push_repository.dart';
import 'package:boothconnect_mobile/data/sync/sync_repository.dart';
import 'package:boothconnect_mobile/features/sync/sync_controller.dart';
import 'package:boothconnect_mobile/features/sync/sync_screen.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:boothconnect_mobile/theme/app_theme.dart';
import 'package:boothconnect_mobile/widgets/sync_status_chip.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/fake_sync_api.dart';
import '../support/memory_secrets.dart';

// Synthetic data only.

Future<void> seedHousehold(AppDatabase db) async {
  await db
      .into(db.syncMeta)
      .insertOnConflictUpdate(
        SyncMetaCompanion.insert(key: 'owner', value: 'u-1'),
      );
  await db
      .into(db.households)
      .insert(
        HouseholdsCompanion.insert(
          id: 'h-1',
          partId: 'part-1',
          pollingStationId: 'station-1',
          displayAddress: '16 Gandhi Road',
          houseKey: '16',
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
          serialNo: const Value(1),
          official: '{"name":"Synthetic Sunita"}',
          previousVoterIds: const [],
        ),
      );
}

/// The volunteer's mobile number and someone else's, both current, and the
/// phone's change that came back as a conflict.
Future<void> seedConflict(AppDatabase db) async {
  await db
      .into(db.fieldValues)
      .insert(
        FieldValuesCompanion.insert(
          id: 'fv-theirs',
          entityType: 'voter',
          entityId: 'v-1',
          fieldKey: 'mobile_number',
          value: '"+919999900332"',
          sourceType: 'volunteer_collected',
          collectedById: const Value('u-2'),
          collectedByName: const Value('Synthetic Priya'),
          collectedAt: DateTime.utc(2026, 9, 30, 4, 10),
          isCurrent: true,
        ),
      );
  await db
      .into(db.fieldValues)
      .insert(
        FieldValuesCompanion.insert(
          id: 'fv-mine',
          entityType: 'voter',
          entityId: 'v-1',
          fieldKey: 'mobile_number',
          value: '"+919999900223"',
          sourceType: 'volunteer_collected',
          collectedById: const Value('u-1'),
          collectedAt: DateTime.utc(2026, 9, 30, 4, 35),
          isCurrent: true,
          conflictWithId: const Value('fv-theirs'),
        ),
      );
  await db
      .into(db.pendingMutations)
      .insert(
        PendingMutationsCompanion.insert(
          key: 'mutation-conflict',
          type: 'field.change',
          householdId: const Value('h-1'),
          payload: jsonEncode({
            'entityType': 'voter',
            'entityId': 'v-1',
            'fieldKey': 'mobile_number',
            'value': '+919999900223',
            'baseVersion': null,
          }),
          status: const Value('conflict'),
          createdAt: DateTime.utc(2026, 9, 30, 4, 35),
        ),
      );
}

var _n = 0;
Future<int> queue(
  AppDatabase db,
  String type, {
  String status = 'pending',
  String? lastError,
  DateTime? nextAttemptAt,
  String? fieldKey,
}) => db
    .into(db.pendingMutations)
    .insert(
      PendingMutationsCompanion.insert(
        key: 'mutation-${_n++}-$type',
        type: type,
        householdId: const Value('h-1'),
        payload: jsonEncode({'fieldKey': ?fieldKey}),
        status: Value(status),
        lastError: Value(lastError),
        nextAttemptAt: Value(nextAttemptAt),
        createdAt: DateTime.utc(2026, 9, 30),
      ),
    );

Future<List<PendingMutationRow>> queued(AppDatabase db) => (db.select(
  db.pendingMutations,
)..orderBy([(t) => OrderingTerm(expression: t.id)])).get();

final conflict = OpenConflict(
  entityType: 'voter',
  entityId: 'v-1',
  fieldKey: 'mobile_number',
  householdId: 'h-1',
  address: '16 Gandhi Road',
  memberName: 'Synthetic Sunita',
  mine: ConflictValue(
    id: 'fv-mine',
    value: '+919999900223',
    collectedAt: DateTime(2026, 10, 1, 10, 5),
    collectedById: 'u-1',
  ),
  other: ConflictValue(
    id: 'fv-theirs',
    value: '+919999900332',
    collectedAt: DateTime(2026, 10, 1, 9, 40),
    collectedById: 'u-2',
    collectedByName: 'Synthetic Priya',
  ),
);

UploadItem item(
  int id,
  String type, {
  String status = 'pending',
  String? lastError,
  DateTime? nextAttemptAt,
  String? fieldKey,
  String? address = '12/4 Gandhi Road',
}) => UploadItem(
  id: id,
  type: type,
  status: status,
  attempts: 1,
  lastError: lastError,
  nextAttemptAt: nextAttemptAt,
  fieldKey: fieldKey,
  address: address,
);

void main() {
  group('reading and writing on the phone', () {
    late Directory dir;
    late LocalStore store;
    late AppDatabase db;

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_uploads_test');
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(MemorySecrets()),
        inBackground: false,
      );
      db = await store.open();
      await seedHousehold(db);
    });
    tearDown(() async {
      await store.wipe();
      dir.deleteSync(recursive: true);
    });

    test(
      'an open conflict: both values, who, when, and whose detail',
      () async {
        await seedConflict(db);
        final c = (await db.watchOpenConflicts().first).single;
        expect(
          (c.entityType, c.entityId, c.fieldKey),
          ('voter', 'v-1', 'mobile_number'),
        );
        expect(c.memberName, 'Synthetic Sunita');
        expect((c.householdId, c.address), ('h-1', '16 Gandhi Road'));
        expect(
          (c.mine.id, c.mine.value, c.mine.collectedById),
          ('fv-mine', '+919999900223', 'u-1'),
        );
        expect(
          (c.other.id, c.other.collectedByName),
          ('fv-theirs', 'Synthetic Priya'),
        );
        // Newest first.
        expect(c.values.map((v) => v.id), ['fv-mine', 'fv-theirs']);
      },
    );

    test('a corrected name, and a household’s own detail', () async {
      await db
          .into(db.fieldValues)
          .insert(
            FieldValuesCompanion.insert(
              id: 'fv-name',
              entityType: 'voter',
              entityId: 'v-1',
              fieldKey: 'name',
              value: '"Synthetic Sunita Devi"',
              sourceType: 'volunteer_collected',
              collectedAt: DateTime.utc(2026, 9, 1),
              isCurrent: true,
            ),
          );
      // An older correction, no longer current, though collected later.
      await db
          .into(db.fieldValues)
          .insert(
            FieldValuesCompanion.insert(
              id: 'fv-name-old',
              entityType: 'voter',
              entityId: 'v-1',
              fieldKey: 'name',
              value: '"Synthetic Wrong"',
              sourceType: 'volunteer_collected',
              collectedAt: DateTime.utc(2026, 9, 20),
              isCurrent: false,
            ),
          );
      // History: a value that was in a conflict, no longer current.
      await db
          .into(db.fieldValues)
          .insert(
            FieldValuesCompanion.insert(
              id: 'fv-history',
              entityType: 'voter',
              entityId: 'v-1',
              fieldKey: 'occupation',
              value: '"Synthetic"',
              sourceType: 'volunteer_collected',
              collectedAt: DateTime.utc(2026, 9, 2),
              isCurrent: false,
              conflictWithId: const Value('fv-name'),
            ),
          );
      await seedConflict(db);
      for (final (id, conflictWith) in [
        ('fv-h-old', null),
        ('fv-h-new', 'fv-h-old'),
      ]) {
        await db
            .into(db.fieldValues)
            .insert(
              FieldValuesCompanion.insert(
                id: id,
                entityType: 'household',
                entityId: 'h-1',
                fieldKey: 'landmark',
                value: '"Synthetic tank"',
                sourceType: 'volunteer_collected',
                collectedAt: DateTime.utc(2026, 9, id == 'fv-h-new' ? 29 : 28),
                isCurrent: true,
                conflictWithId: Value(conflictWith),
              ),
            );
      }
      final conflicts = await db.watchOpenConflicts().first;
      expect(conflicts.map((c) => c.mine.id), ['fv-mine', 'fv-h-new']);
      expect(conflicts.first.memberName, 'Synthetic Sunita Devi');
      final household = conflicts.last;
      expect(household.memberName, isNull);
      expect(
        (household.householdId, household.address),
        ('h-1', '16 Gandhi Road'),
      );
    });

    test('a pull stores both values of every open conflict', () async {
      Map<String, Object?> value(String id, String v, {String? with_}) => {
        'id': id,
        'entityType': 'voter',
        'entityId': 'v-1',
        'fieldKey': 'occupation',
        'value': v,
        'sourceType': 'volunteer_collected',
        'collectedBy': {'id': 'u-2', 'name': 'Synthetic Priya'},
        'collectedAt': '2026-09-30T04:00:00.000Z',
        'supersedesId': null,
        'carriedFromId': null,
        'isCurrent': true,
        'conflictWithId': with_,
      };
      await db
          .into(db.syncMeta)
          .insert(SyncMetaCompanion.insert(key: 'cursor', value: 'c-1'));
      final page = syncPage(cursor: 'c-2')
        ..['conflicts'] = [
          {
            'entityType': 'voter',
            'entityId': 'v-1',
            'fieldKey': 'occupation',
            'values': [
              value('fv-b', 'Farmer', with_: 'fv-a'),
              value('fv-a', 'Teacher'),
            ],
          },
        ];
      await SyncRepository(db, FakeSyncApi([page])).pull();
      final c = (await db.watchOpenConflicts().first).single;
      expect((c.mine.id, c.other.id), ('fv-b', 'fv-a'));
      expect(c.other.collectedByName, 'Synthetic Priya');
    });

    test(
      'keeping a value: the other leaves, and the choice is queued',
      () async {
        await seedConflict(db);
        final c = (await db.watchOpenConflicts().first).single;
        await db.resolveConflict(c, 'fv-theirs');

        final values = {
          for (final v in await db.select(db.fieldValues).get()) v.id: v,
        };
        expect(values['fv-theirs']!.isCurrent, isTrue);
        expect(values['fv-mine']!.isCurrent, isFalse);
        // Both stay in the history, with no open conflict.
        expect(
          values.values.map((v) => v.conflictWithId),
          everyElement(isNull),
        );
        expect(await db.watchOpenConflicts().first, isEmpty);
        expect((await db.watchMemberCards('h-1').first).single.id, 'v-1');

        final m = (await queued(db)).single;
        expect(m.type, 'conflict.resolve');
        expect(m.householdId, 'h-1');
        expect(jsonDecode(m.payload), {
          'conflictId': 'fv-mine',
          'keepFieldValueId': 'fv-theirs',
        });
        // The household is no longer "Choose value", just waiting to upload.
        final summary = (await db.watchHouseholdSummaries().first).single;
        expect(summary.sync, HouseholdSync.onPhone);
      },
    );

    test('only one of the two values can be kept', () async {
      await seedConflict(db);
      final c = (await db.watchOpenConflicts().first).single;
      await expectLater(
        db.resolveConflict(c, 'fv-unknown'),
        throwsArgumentError,
      );
      expect(await db.watchOpenConflicts().first, hasLength(1));
      expect((await queued(db)).single.status, 'conflict');
    });

    test('the queue: waiting and refused changes, not conflicts', () async {
      await seedConflict(db);
      await queue(db, 'visit.create', status: 'syncing');
      await queue(db, 'field.change', fieldKey: 'occupation');
      await queue(db, 'visit.create', status: 'failed', lastError: 'X');
      final items = await db.watchUploadQueue().first;
      expect(items.map((i) => (i.type, i.status)), [
        ('visit.create', 'syncing'),
        ('field.change', 'pending'),
        ('visit.create', 'failed'),
      ]);
      expect(items.map((i) => i.address), everyElement('16 Gandhi Road'));
      expect(items[1].fieldKey, 'occupation');
      expect(items.last.lastError, 'X');
    });

    test('retrying one change: due now, the others untouched', () async {
      final later = DateTime.utc(2026, 10, 1, 12);
      final a = await queue(db, 'visit.create', nextAttemptAt: later);
      final b = await queue(db, 'visit.create', status: 'failed');
      final c = await queue(db, 'visit.create', nextAttemptAt: later);
      await seedConflict(db);
      final push = PushRepository(db, FakeSyncApi());
      await push.retryOne(a);
      await push.retryOne(b);
      final rows = {for (final m in await queued(db)) m.id: m};
      expect((rows[a]!.status, rows[a]!.nextAttemptAt), ('pending', null));
      expect((rows[b]!.status, rows[b]!.nextAttemptAt), ('pending', null));
      expect(rows[c]!.nextAttemptAt, isNotNull);
      // A conflict isn't retried: it waits for a choice.
      final conflictRow = rows.values.singleWhere(
        (m) => m.status == 'conflict',
      );
      await push.retryOne(conflictRow.id);
      expect(
        (await queued(db)).singleWhere((m) => m.id == conflictRow.id).status,
        'conflict',
      );
    });
  });

  group('the Uploads screen', () {
    Future<void> show(
      WidgetTester tester, {
      List<OpenConflict> conflicts = const [],
      List<UploadItem> items = const [],
      bool online = true,
      String? owner = 'u-1',
      Locale locale = const Locale('en'),
      double textScale = 1,
    }) async {
      await tester.pumpWidget(
        ProviderScope(
          key: UniqueKey(),
          overrides: <Override>[
            openConflictsProvider.overrideWith(
              (ref) => Stream.value(conflicts),
            ),
            uploadQueueProvider.overrideWith((ref) => Stream.value(items)),
            ownerProvider.overrideWith((ref) => Stream.value(owner)),
            onlineProvider.overrideWith((ref) => Stream.value(online)),
          ],
          child: MaterialApp(
            theme: AppTheme.light(),
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            builder: (context, child) => MediaQuery.withClampedTextScaling(
              minScaleFactor: textScale,
              maxScaleFactor: textScale,
              child: child!,
            ),
            home: const SyncScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    final busy = [
      item(1, 'visit.create', status: 'syncing', address: '14 Gandhi Road'),
      item(
        2,
        'field.change',
        fieldKey: 'occupation',
        nextAttemptAt: DateTime.now().add(const Duration(hours: 2)),
      ),
      item(3, 'visit.create', address: null),
    ];

    testWidgets('nothing waiting', (tester) async {
      await show(tester);
      expect(find.text('Online · everything uploaded'), findsOneWidget);
      expect(
        find.text('Nothing is waiting. Everything you saved is on the server.'),
        findsOneWidget,
      );
      expect(find.text('Upload now'), findsNothing);
      expect(find.text('Choose which value to keep'), findsNothing);

      await show(tester, online: false);
      expect(find.text('Offline · nothing waiting'), findsOneWidget);
    });

    testWidgets('uploading: each change and how it stands', (tester) async {
      await show(tester, items: busy);
      expect(find.text('Online · uploading 1 of 3'), findsOneWidget);
      expect(find.text('Waiting to upload'), findsOneWidget);
      expect(find.text('Visit · 14 Gandhi Road'), findsOneWidget);
      expect(find.text('Uploading now'), findsOneWidget);
      expect(find.text('Occupation · 12/4 Gandhi Road'), findsOneWidget);
      expect(find.textContaining('Next try at '), findsOneWidget);
      expect(find.text('Visit · A household'), findsOneWidget);
      expect(find.text('Waiting for the connection'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SyncStatusChip),
          matching: find.text('Uploading'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byType(SyncStatusChip),
          matching: find.text('On phone'),
        ),
        findsNWidgets(2),
      );
      // Already uploading: no Upload now.
      expect(find.text('Upload now'), findsNothing);
    });

    testWidgets('waiting: Upload now; offline says so', (tester) async {
      final waiting = busy.skip(1).toList();
      await show(tester, items: waiting);
      expect(find.text('Online · 2 waiting'), findsOneWidget);
      expect(find.text('Upload now'), findsOneWidget);
      await show(tester, items: waiting, online: false);
      expect(find.text('Offline · 2 waiting'), findsOneWidget);
    });

    testWidgets('not uploaded: the reason, what to do, and Retry', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await show(
        tester,
        items: [
          item(4, 'visit.create', status: 'failed', lastError: 'NOT_FOUND'),
          item(5, 'conflict.resolve', status: 'failed', lastError: 'SOMETHING'),
        ],
      );
      expect(find.text('Not uploaded'), findsOneWidget);
      expect(find.text('Waiting to upload'), findsNothing);
      expect(find.text('Visit · 12/4 Gandhi Road'), findsOneWidget);
      expect(find.text('Chosen value · 12/4 Gandhi Road'), findsOneWidget);
      expect(
        find.text(
          'Tap Retry. If it still isn’t uploaded, tell your coordinator.',
        ),
        findsNothing,
      );
      expect(
        find.text(
          "Tap Retry. If it still isn't uploaded, tell your coordinator.",
        ),
        findsNWidgets(2),
      );
      expect(find.text('Retry'), findsNWidgets(2));
      expect(
        tester.getSemantics(
          find.bySemanticsLabel('Retry: Visit · 12/4 Gandhi Road'),
        ),
        isSemantics(isButton: true, hasTapAction: true),
      );
      handle.dispose();
    });

    testWidgets('a conflict: both values, who and when, yours chosen', (
      tester,
    ) async {
      await show(tester, conflicts: [conflict]);
      expect(find.text('Choose which value to keep'), findsOneWidget);
      expect(find.text('Synthetic Sunita · Mobile number'), findsOneWidget);
      expect(
        find.text('16 Gandhi Road. Two people changed it while offline.'),
        findsOneWidget,
      );
      expect(find.text('+919999900223'), findsOneWidget);
      expect(find.text('+919999900332'), findsOneWidget);
      expect(
        find.textContaining(RegExp(r'^Yours · Oct 1 10:05\sAM$')),
        findsOneWidget,
      );
      expect(
        find.textContaining(RegExp(r'^Synthetic Priya · Oct 1 9:40\sAM$')),
        findsOneWidget,
      );
      final group = tester.widget<RadioGroup<String>>(
        find.byType(RadioGroup<String>),
      );
      expect(group.groupValue, 'fv-mine');
      expect(find.text('Keep selected value'), findsOneWidget);
      // Something needs a choice: not "nothing is waiting".
      expect(find.textContaining('Nothing is waiting'), findsNothing);
    });

    testWidgets('your own value is chosen first, even when older', (
      tester,
    ) async {
      final older = OpenConflict(
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        fieldKey: conflict.fieldKey,
        address: conflict.address,
        memberName: conflict.memberName,
        mine: conflict.other,
        other: ConflictValue(
          id: 'fv-yours-older',
          value: '+919999900111',
          collectedAt: DateTime(2026, 10, 1, 8),
          collectedById: 'u-1',
        ),
      );
      await show(tester, conflicts: [older]);
      expect(
        tester
            .widget<RadioGroup<String>>(find.byType(RadioGroup<String>))
            .groupValue,
        'fv-yours-older',
      );
    });

    testWidgets('someone unknown, and the newest when neither is yours', (
      tester,
    ) async {
      await show(tester, conflicts: [conflict], owner: 'u-9');
      expect(find.textContaining('Yours'), findsNothing);
      final group = tester.widget<RadioGroup<String>>(
        find.byType(RadioGroup<String>),
      );
      expect(group.groupValue, 'fv-mine');

      final anonymous = OpenConflict(
        entityType: 'household',
        entityId: 'h-1',
        fieldKey: 'address',
        mine: ConflictValue(
          id: 'a',
          value: {'house_no': '16', 'area': 'Synthetic Nagar'},
          collectedAt: DateTime(2026, 10, 1, 8),
        ),
        other: ConflictValue(
          id: 'b',
          value: {'house_no': '16A'},
          collectedAt: DateTime(2026, 10, 1, 9),
        ),
      );
      await show(tester, conflicts: [anonymous]);
      expect(find.text('A household · Address'), findsOneWidget);
      expect(find.text('16, Synthetic Nagar'), findsOneWidget);
      expect(find.textContaining('Someone else ·'), findsNWidgets(2));
      // The newer one first, and chosen.
      expect(
        tester
            .widget<RadioGroup<String>>(find.byType(RadioGroup<String>))
            .groupValue,
        'b',
      );
    });

    testWidgets('meets the tap-target, label and contrast guidelines', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await show(
        tester,
        conflicts: [conflict],
        items: [
          ...busy.skip(1),
          item(4, 'visit.create', status: 'failed', lastError: 'NOT_FOUND'),
        ],
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('fits a small phone at 2× text', (tester) async {
      tester.view.physicalSize = const Size(320, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      for (final locale in const [Locale('en'), Locale('te')]) {
        await show(
          tester,
          locale: locale,
          textScale: 2,
          conflicts: [conflict],
          items: [
            ...busy,
            item(4, 'visit.create', status: 'failed', lastError: 'NOT_FOUND'),
          ],
        );
        expect(tester.takeException(), isNull, reason: '$locale');
        for (var i = 0; i < 40; i++) {
          await tester.drag(find.byType(ListView), const Offset(0, -200));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$locale');
        }
      }
    });

    testWidgets('in Telugu', (tester) async {
      await show(
        tester,
        locale: const Locale('te'),
        conflicts: [conflict],
        items: busy,
      );
      expect(find.text('ఏ విలువ ఉంచాలో ఎంచుకోండి'), findsOneWidget);
      expect(find.text('ఎంచుకున్న విలువను ఉంచండి'), findsOneWidget);
    });
  });

  group('in the app', () {
    Future<(ProviderContainer, AppDatabase, FakeSyncApi)> open(
      WidgetTester tester,
      Future<void> Function(AppDatabase db) seed, {
      bool online = false,
    }) async {
      // Downloads fail (the data stays as seeded); uploads answer.
      final api = FakeSyncApi(List.filled(20, offline, growable: true));
      final container = await startApp(
        tester,
        api: FakeAuthApi(session: true),
        syncApi: api,
        connectivity: Stream.value([
          online ? ConnectivityResult.wifi : ConnectivityResult.none,
        ]),
      );
      final db = await settle(
        tester,
        container.read(appDatabaseProvider.future),
      );
      await settle(tester, seedHousehold(db));
      await settle(tester, seed(db));
      await go(tester, container, '/sync');
      await waitFor(
        tester,
        () =>
            find.text('Upload now').evaluate().isNotEmpty ||
            find.text('Keep selected value').evaluate().isNotEmpty,
      );
      return (container, db, api);
    }

    testWidgets('choosing a value queues it; the card goes', (tester) async {
      final (_, db, _) = await open(tester, seedConflict);
      await tester.tap(find.text('+919999900332'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Keep selected value'));
      await waitFor(
        tester,
        () => find.text('Keep selected value').evaluate().isEmpty,
      );
      expect(
        find.text('Kept. The other value stays in the history.'),
        findsOneWidget,
      );
      final m = (await settle(tester, queued(db))).single;
      expect(m.type, 'conflict.resolve');
      expect(jsonDecode(m.payload), {
        'conflictId': 'fv-mine',
        'keepFieldValueId': 'fv-theirs',
      });
      // Offline: it waits to upload.
      await waitFor(
        tester,
        () => find.text('Chosen value · 16 Gandhi Road').evaluate().isNotEmpty,
      );
      expect(find.text('Offline · 1 waiting'), findsOneWidget);
    });

    testWidgets('Retry sends a refused change again', (tester) async {
      late int failed;
      final (_, db, api) = await open(tester, (db) async {
        failed = await queue(db, 'visit.create', status: 'failed');
      }, online: true);
      await waitFor(tester, () => find.text('Retry').evaluate().isNotEmpty);
      await tester.tap(find.text('Retry'));
      await waitFor(tester, () => api.pushed.isNotEmpty);
      expect(
        api.pushed.single.single['key'],
        'mutation-${_n - 1}-visit.create',
      );
      await waitFor(
        tester,
        () => find.text('Online · everything uploaded').evaluate().isNotEmpty,
      );
      expect(
        (await settle(tester, queued(db))).where((m) => m.id == failed),
        isEmpty,
      );
    });

    testWidgets('Upload now doesn’t wait for the next try', (tester) async {
      final (_, db, api) = await open(tester, (db) async {
        await queue(
          db,
          'visit.create',
          nextAttemptAt: DateTime.now().add(const Duration(hours: 1)),
        );
      }, online: true);
      await waitFor(
        tester,
        () => find.textContaining('Next try at').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Upload now'));
      await waitFor(tester, () => api.pushed.isNotEmpty);
      expect(await settle(tester, queued(db)), isEmpty);
    });
  });
}
