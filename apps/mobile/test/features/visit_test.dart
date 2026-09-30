import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/ids.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/local/local_writes.dart';
import 'package:boothconnect_mobile/features/households/household_screen.dart';
import 'package:boothconnect_mobile/features/members/member_screen.dart';
import 'package:boothconnect_mobile/features/visit/visit_screen.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:boothconnect_mobile/theme/app_theme.dart';
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
final uuid = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);

HouseholdsCompanion household(String id) => HouseholdsCompanion.insert(
  id: id,
  partId: 'part-1',
  pollingStationId: 'station-1',
  displayAddress: '12/4 Gandhi Road',
  houseKey: '12/4',
  origin: 'official_import',
  status: 'active',
);

VotersCompanion voter(String id, String name, int serial) =>
    VotersCompanion.insert(
      id: id,
      householdId: 'h-1',
      partId: 'part-1',
      pollingStationId: 'station-1',
      origin: 'official_import',
      recordStatus: 'active',
      sectionNo: const Value(1),
      serialNo: Value(serial),
      official: jsonEncode({'name': name, 'age': 40}),
      previousVoterIds: const [],
    );

/// The volunteer (`sync_meta.owner`), a household and two members.
Future<void> seed(AppDatabase db, {bool owner = true}) async {
  if (owner) {
    await db
        .into(db.syncMeta)
        .insert(SyncMetaCompanion.insert(key: 'owner', value: 'u-1'));
  }
  await db.into(db.households).insert(household('h-1'));
  await db.into(db.voters).insert(voter('v-1', 'Synthetic Lakshmi', 1));
  await db.into(db.voters).insert(voter('v-2', 'Synthetic Arjun', 2));
}

Future<List<PendingMutationRow>> queued(AppDatabase db) => (db.select(
  db.pendingMutations,
)..orderBy([(t) => OrderingTerm(expression: t.id)])).get();

Map<String, dynamic> payloadOf(PendingMutationRow row) =>
    jsonDecode(row.payload) as Map<String, dynamic>;

void main() {
  group('ids', () {
    test('random version 4 UUIDs', () {
      final ids = {for (var i = 0; i < 200; i++) newId()};
      expect(ids, hasLength(200));
      expect(ids, everyElement(matches(uuid)));
      expect(newId(Random(1)), newId(Random(1)));
    });

    test('times to the millisecond, in UTC, always the same length', () {
      expect(
        isoMillis(DateTime.utc(2026, 9, 30, 4, 25, 12, 345, 678)),
        '2026-09-30T04:25:12.345Z',
      );
      expect(isoMillis(DateTime.utc(2026, 9, 30)), '2026-09-30T00:00:00.000Z');
      expect(
        isoMillis(DateTime.utc(2026, 9, 30, 10).toLocal()),
        '2026-09-30T10:00:00.000Z',
      );
    });
  });

  group('writes on the phone', () {
    // A real clock: Drift on real files.
    late Directory dir;
    late LocalStore store;
    late AppDatabase db;

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_visit_test');
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

    test('a visit is saved and queued as visit.create', () async {
      await seed(db);
      final started = DateTime.utc(2026, 9, 30, 10);
      final done = DateTime.utc(2026, 9, 30, 10, 5);
      final clientId = await db.recordVisit(
        householdId: 'h-1',
        outcome: 'completed',
        startedAt: started,
        completedAt: done,
        memberIdsMet: ['v-1'],
        notes: '  Asked for the booth slip.  ',
      );
      expect(clientId, matches(uuid));

      final visit = await db.select(db.visits).getSingle();
      expect(visit.clientId, clientId);
      expect(visit.serverId, isNull);
      expect(visit.volunteerId, 'u-1');
      expect(visit.outcome, 'completed');
      expect(visit.memberIdsMet, ['v-1']);
      expect(visit.notes, 'Asked for the booth slip.');

      final mutation = (await queued(db)).single;
      expect(mutation.type, 'visit.create');
      expect(mutation.key, matches(uuid));
      expect(mutation.key, isNot(clientId));
      expect(mutation.householdId, 'h-1');
      expect(mutation.status, 'pending');
      expect(payloadOf(mutation), {
        'clientId': clientId,
        'householdId': 'h-1',
        'startedAt': '2026-09-30T10:00:00.000Z',
        'completedAt': '2026-09-30T10:05:00.000Z',
        'outcome': 'completed',
        'formVersion': '1',
        'notes': 'Asked for the booth slip.',
        'memberIdsMet': ['v-1'],
      });

      // The list shows it at once: visited, and on the phone.
      final summary = (await db.watchHouseholdSummaries().first).single;
      expect(summary.visitStatus, VisitStatus.visited);
      expect(summary.sync, HouseholdSync.onPhone);
    });

    test('blank notes are left out', () async {
      await seed(db);
      await db.recordVisit(
        householdId: 'h-1',
        outcome: 'refused',
        startedAt: DateTime.utc(2026, 9, 30),
        completedAt: DateTime.utc(2026, 9, 30),
        notes: '   ',
      );
      expect((await db.select(db.visits).getSingle()).notes, isNull);
      expect(payloadOf((await queued(db)).single), isNot(contains('notes')));
    });

    test('without a signed-in volunteer, nothing is written', () async {
      await seed(db, owner: false);
      await expectLater(
        db.recordVisit(
          householdId: 'h-1',
          outcome: 'refused',
          startedAt: DateTime.utc(2026, 9, 30),
          completedAt: DateTime.utc(2026, 9, 30),
        ),
        throwsStateError,
      );
      expect(await db.select(db.visits).get(), isEmpty);
      expect(await queued(db), isEmpty);
    });

    test('an edit keeps the value it replaces as its base_version', () async {
      await seed(db);
      await db
          .into(db.fieldValues)
          .insert(
            FieldValuesCompanion.insert(
              id: 'fv-server',
              entityType: 'voter',
              entityId: 'v-1',
              fieldKey: 'occupation',
              value: '"Farmer"',
              sourceType: 'volunteer_collected',
              collectedAt: DateTime.utc(2026, 9, 1),
              isCurrent: true,
            ),
          );
      final at = DateTime.utc(2026, 9, 30, 10);
      await db.changeField(
        entityType: 'voter',
        entityId: 'v-1',
        householdId: 'h-1',
        fieldKey: 'occupation',
        value: 'Teacher',
        at: at,
      );

      final values = await (db.select(
        db.fieldValues,
      )..where((t) => t.fieldKey.equals('occupation'))).get();
      final old = values.singleWhere((v) => v.id == 'fv-server');
      final now = values.singleWhere((v) => v.id != 'fv-server');
      expect(old.isCurrent, isFalse);
      expect(now.isCurrent, isTrue);
      expect(now.value, '"Teacher"');
      expect(now.supersedesId, 'fv-server');
      expect(now.collectedById, 'u-1');
      expect(now.id, matches(uuid));

      final mutation = (await queued(db)).single;
      expect(mutation.type, 'field.change');
      expect(mutation.householdId, 'h-1');
      expect(payloadOf(mutation), {
        'entityType': 'voter',
        'entityId': 'v-1',
        'fieldKey': 'occupation',
        'value': 'Teacher',
        'baseVersion': 'fv-server',
        'collectedAt': '2026-09-30T10:00:00.000Z',
      });
      // The member card shows the new value.
      final card = (await db.watchMemberCards('h-1').first).first;
      expect(card.occupation, 'Teacher');
    });

    test('a new detail has no base_version', () async {
      await seed(db);
      await db.changeField(
        entityType: 'voter',
        entityId: 'v-2',
        householdId: 'h-1',
        fieldKey: 'mobile_number',
        value: '+919999900999',
        at: DateTime.utc(2026, 9, 30),
      );
      final payload = payloadOf((await queued(db)).single);
      expect(payload['baseVersion'], isNull);
      expect(payload, contains('baseVersion'));
    });

    test('editing again before upload updates the queued change', () async {
      await seed(db);
      Future<void> change(String value, int minute) => db.changeField(
        entityType: 'voter',
        entityId: 'v-1',
        householdId: 'h-1',
        fieldKey: 'occupation',
        value: value,
        at: DateTime.utc(2026, 9, 30, 10, minute),
      );
      await change('Teacher', 0);
      await change('Head teacher', 5);

      final mutation = (await queued(db)).single;
      expect(payloadOf(mutation)['value'], 'Head teacher');
      expect(payloadOf(mutation)['baseVersion'], isNull);
      expect(payloadOf(mutation)['collectedAt'], '2026-09-30T10:05:00.000Z');
      final current = await (db.select(
        db.fieldValues,
      )..where((t) => t.isCurrent.equals(true))).get();
      expect(current.single.value, '"Head teacher"');
      expect(await db.select(db.fieldValues).get(), hasLength(1));

      // Once it's being uploaded, a further edit is a change of its own.
      await (db.update(db.pendingMutations)
            ..where((t) => t.id.equals(mutation.id)))
          .write(const PendingMutationsCompanion(status: Value('syncing')));
      await change('Principal', 9);
      final all = await queued(db);
      expect(all, hasLength(2));
      expect(payloadOf(all.last)['value'], 'Principal');
      expect(payloadOf(all.last)['baseVersion'], current.single.id);
      // Another field of the same member is its own change too.
      await db.changeField(
        entityType: 'voter',
        entityId: 'v-1',
        householdId: 'h-1',
        fieldKey: 'age',
        value: 47,
        at: DateTime.utc(2026, 9, 30, 10, 10),
      );
      expect(await queued(db), hasLength(3));
    });

    test('the changes made during a visit, by member', () async {
      await seed(db);
      Future<void> change(String member, String field, DateTime at) =>
          db.changeField(
            entityType: 'voter',
            entityId: member,
            householdId: 'h-1',
            fieldKey: field,
            value: 'x',
            at: at,
          );
      final start = DateTime.utc(2026, 9, 30, 10);
      await change(
        'v-1',
        'occupation',
        start.subtract(const Duration(days: 1)),
      );
      await change(
        'v-2',
        'additional_info',
        start.subtract(const Duration(days: 1)),
      );
      await change('v-1', 'mobile_number', start);
      await change('v-1', 'occupation', start.add(const Duration(minutes: 1)));
      await change(
        'v-1',
        'mobile_number',
        start.add(const Duration(minutes: 2)),
      );
      // Not a member: the household's own detail.
      await db.changeField(
        entityType: 'household',
        entityId: 'h-1',
        householdId: 'h-1',
        fieldKey: 'landmark',
        value: 'x',
        at: start.add(const Duration(minutes: 3)),
      );

      // An edit while the earlier one is being uploaded is a change of its
      // own; the field is listed once.
      await db.customStatement(
        "UPDATE pending_mutation SET status = 'syncing' "
        r"WHERE json_extract(payload, '$.fieldKey') = 'occupation'",
      );
      await change('v-1', 'occupation', start.add(const Duration(minutes: 4)));

      final changes = await db.watchMemberChangesSince('h-1', start).first;
      // v-1's occupation was changed before, then again now: it counts.
      expect(changes, {
        'v-1': ['occupation', 'mobile_number'],
      });
      expect(await db.watchMemberChangesSince('h-2', start).first, isEmpty);
    });
  });

  group('the visit form', () {
    const members = [
      MemberCard(id: 'v-1', name: 'Synthetic Lakshmi'),
      MemberCard(id: 'v-2', name: 'Synthetic Arjun'),
    ];

    Future<void> show(
      WidgetTester tester, {
      Map<String, List<String>> changes = const {},
      Locale locale = const Locale('en'),
      double textScale = 1,
    }) async {
      await tester.pumpWidget(
        ProviderScope(
          key: UniqueKey(),
          overrides: <Override>[
            householdSummaryProvider.overrideWith(
              (ref, id) => Stream.value(
                const HouseholdSummary(
                  id: 'h-1',
                  address: '12/4 Gandhi Road',
                  houseKey: '12/4',
                  members: 2,
                ),
              ),
            ),
            memberCardsProvider.overrideWith(
              (ref, id) => Stream.value(members),
            ),
            visitChangesProvider.overrideWith(
              (ref, arg) => Stream.value(changes),
            ),
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
            home: const VisitScreen(householdId: 'h-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('outcomes in plain words; the rarer ones on request', (
      tester,
    ) async {
      await show(tester);
      expect(find.text('Visit · 12/4 Gandhi Road'), findsOneWidget);
      for (final label in [
        'Met the family',
        'Met some members',
        'No one home',
        'Refused',
        'Come back later',
      ]) {
        expect(find.widgetWithText(ChoiceChip, label), findsOneWidget);
      }
      expect(find.text('Family has moved'), findsNothing);

      await tester.tap(find.text('More options…'));
      await tester.pumpAndSettle();
      for (final label in [
        'Address not found',
        'Family has moved',
        'Voter has passed away',
        'Duplicate or wrong entry',
        "Couldn't reach safely",
      ]) {
        expect(find.widgetWithText(ChoiceChip, label), findsOneWidget);
      }

      // A rarer outcome stays visible once chosen.
      await tester.tap(find.text('Family has moved'));
      await tester.tap(find.text('Fewer options'));
      await tester.pumpAndSettle();
      expect(find.text('Family has moved'), findsOneWidget);
      expect(find.text('Address not found'), findsNothing);
    });

    testWidgets('Save waits for an outcome', (tester) async {
      await show(tester);
      FilledButton save() => tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Save visit'),
      );
      expect(save().onPressed, isNull);
      expect(
        find.text('Choose how the visit went to save it.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Met the family'));
      await tester.pumpAndSettle();
      expect(save().onPressed, isNotNull);
      expect(find.text('Choose how the visit went to save it.'), findsNothing);
    });

    testWidgets('who you met: only when someone was met', (tester) async {
      await show(tester);
      expect(find.text('Who did you meet?'), findsNothing);
      for (final outcome in [
        'Met the family',
        'Met some members',
        'Come back later',
      ]) {
        await tester.tap(find.text(outcome));
        await tester.pumpAndSettle();
        expect(find.text('Who did you meet?'), findsOneWidget, reason: outcome);
      }
      await tester.tap(find.text('More options…'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Address not found'));
      await tester.pumpAndSettle();
      expect(find.text('Who did you meet?'), findsNothing);
    });

    testWidgets('each member: met or not, what changed, and Edit', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await show(
        tester,
        changes: {
          'v-2': ['mobile_number', 'occupation'],
        },
      );
      await tester.tap(find.text('Met the family'));
      await tester.pumpAndSettle();
      expect(find.text('Not met'), findsOneWidget);
      expect(find.text('Updated mobile number, occupation'), findsOneWidget);

      await tester.tap(find.text('Synthetic Lakshmi'));
      await tester.pumpAndSettle();
      expect(find.text('No changes'), findsOneWidget);
      expect(find.text('Not met'), findsNothing);
      await tester.tap(find.text('Synthetic Lakshmi'));
      await tester.pumpAndSettle();
      expect(find.text('Not met'), findsOneWidget);

      expect(
        tester.getSemantics(find.bySemanticsLabel('Edit Synthetic Arjun')),
        isSemantics(isButton: true, hasTapAction: true),
      );
      handle.dispose();
    });

    testWidgets('notes warn against sensitive details', (tester) async {
      await show(tester);
      expect(find.text('Notes (optional)'), findsOneWidget);
      expect(
        find.text("Don't record health, religion or party details."),
        findsOneWidget,
      );
    });

    testWidgets('meets the tap-target, label and contrast guidelines', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await show(tester);
      await tester.tap(find.text('Met the family'));
      await tester.pumpAndSettle();
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
          changes: {
            'v-2': ['mobile_number', 'occupation'],
          },
        );
        expect(tester.takeException(), isNull, reason: '$locale');
        await tester.tap(find.byType(ChoiceChip).first);
        await tester.pumpAndSettle();
        // Down to Save, a screen at a time.
        final save = find.byType(FilledButton).hitTestable();
        while (save.evaluate().isEmpty) {
          await tester.drag(find.byType(ListView), const Offset(0, -200));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$locale');
        }
      }
    });

    testWidgets('in Telugu', (tester) async {
      await show(tester, locale: const Locale('te'));
      expect(find.text('సందర్శన ఎలా జరిగింది?'), findsOneWidget);
      expect(find.text('సందర్శనను సేవ్ చేయండి'), findsOneWidget);
    });
  });

  group('in the app, offline', () {
    /// Signed in, offline (every pull fails), with [seed]'s data.
    Future<(ProviderContainer, AppDatabase)> openVisit(
      WidgetTester tester, {
      Future<void> Function(AppDatabase db)? before,
    }) async {
      final container = await startApp(
        tester,
        api: FakeAuthApi(session: true),
        syncApi: FakeSyncApi(List.filled(20, offline, growable: true)),
        connectivity: Stream.value([ConnectivityResult.none]),
      );
      final db = await settle(
        tester,
        container.read(appDatabaseProvider.future),
      );
      await settle(tester, seed(db));
      if (before != null) await settle(tester, before(db));
      await go(tester, container, '/household/h-1');
      await waitFor(
        tester,
        () => find.text('Start visit').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Start visit'));
      await waitFor(
        tester,
        () => find.text('How did it go?').evaluate().isNotEmpty,
      );
      return (container, db);
    }

    testWidgets('Refused saves at once, with no more questions', (
      tester,
    ) async {
      final (_, db) = await openVisit(tester);
      // Someone ticked as met, then the family refused: nobody was met.
      await tester.tap(find.text('Met the family'));
      await waitFor(
        tester,
        () => find.text('Synthetic Lakshmi').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Synthetic Lakshmi'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Refused'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).hitTestable().evaluate().isNotEmpty,
      );
      expect(find.byType(VisitScreen), findsNothing);
      expect(
        find.text("Visit saved. It uploads when you're online."),
        findsOneWidget,
      );

      final visit = (await settle(tester, db.select(db.visits).get())).single;
      expect(visit.outcome, 'refused');
      expect(visit.memberIdsMet, isEmpty);
      final mutation = (await settle(tester, queued(db))).single;
      expect(mutation.type, 'visit.create');
      expect(payloadOf(mutation)['clientId'], visit.clientId);

      // The household shows the visit, on the phone.
      await waitFor(
        tester,
        () => find.textContaining('Last visit').evaluate().isNotEmpty,
      );
      expect(find.textContaining('Refused'), findsOneWidget);
      expect(find.text('On phone'), findsOneWidget);
    });

    testWidgets('a full visit: edit a member, tick who you met, save', (
      tester,
    ) async {
      final (_, db) = await openVisit(
        tester,
        // Changed before this visit: not this visit's change.
        before: (db) => db.changeField(
          entityType: 'voter',
          entityId: 'v-1',
          householdId: 'h-1',
          fieldKey: 'mobile_number',
          value: '+919999900998',
          at: DateTime(2026, 1, 1),
        ),
      );
      await tester.tap(find.text('Met some members'));
      await waitFor(
        tester,
        () => find.text('Who did you meet?').evaluate().isNotEmpty,
      );

      // Edit opens the member's details. Saving there (#114) changes the
      // detail on the phone; back in the visit, the row says so.
      await tester.tap(find.text('Edit').last);
      await waitFor(
        tester,
        () => find.byType(MemberScreen).evaluate().isNotEmpty,
      );
      expect(
        tester.widget<MemberScreen>(find.byType(MemberScreen)).memberId,
        'v-2',
      );
      await settle(
        tester,
        db.changeField(
          entityType: 'voter',
          entityId: 'v-2',
          householdId: 'h-1',
          fieldKey: 'occupation',
          value: 'Farmer',
          at: DateTime.now(),
        ),
      );
      await tester.tap(find.byType(BackButton));
      await waitFor(
        tester,
        () => find.text('Updated occupation').evaluate().isNotEmpty,
      );

      expect(find.textContaining('mobile number'), findsNothing);
      await tester.tap(find.text('Synthetic Lakshmi'));
      await tester.pumpAndSettle();
      expect(find.text('No changes'), findsOneWidget);
      await tester.enterText(
        find.byType(TextField),
        'Asked for the booth slip.',
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save visit'));
      // A double tap saves once.
      await tester.tap(find.text('Save visit'));
      await tester.tap(find.text('Save visit'), warnIfMissed: false);
      await waitFor(tester, () => find.byType(VisitScreen).evaluate().isEmpty);

      final mutations = await settle(tester, queued(db));
      expect(mutations.map((m) => m.type), [
        'field.change',
        'field.change',
        'visit.create',
      ]);
      expect(mutations.map((m) => m.key).toSet(), hasLength(3));
      final visit = payloadOf(mutations.last);
      expect(visit['outcome'], 'partially_completed');
      expect(visit['memberIdsMet'], ['v-1']);
      expect(visit['notes'], 'Asked for the booth slip.');
      expect(payloadOf(mutations[1])['value'], 'Farmer');
      expect(await settle(tester, db.select(db.visits).get()), hasLength(1));
    });

    testWidgets('Cancel leaves without saving', (tester) async {
      final (_, db) = await openVisit(tester);
      await tester.tap(find.text('Met the family'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Cancel'));
      await waitFor(tester, () => find.byType(VisitScreen).evaluate().isEmpty);
      expect(find.byType(HouseholdScreen), findsOneWidget);
      expect(await settle(tester, db.select(db.visits).get()), isEmpty);
      expect(await settle(tester, queued(db)), isEmpty);
    });
  });
}
