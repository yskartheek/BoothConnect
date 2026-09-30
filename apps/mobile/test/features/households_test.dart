import 'dart:async';
import 'dart:io';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/households/household_screen.dart';
import 'package:boothconnect_mobile/features/households/households_screen.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:boothconnect_mobile/theme/app_theme.dart';
import 'package:boothconnect_mobile/widgets/sync_status_chip.dart';
import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/memory_secrets.dart';

// Synthetic data only.
HouseholdSummary summary(
  String id,
  String address, {
  String? key,
  int members = 3,
  List<String> names = const [],
  String? lastOutcome,
  int onPhone = 0,
  int conflicts = 0,
}) => HouseholdSummary(
  id: id,
  address: address,
  houseKey: key ?? address.split(' ').first,
  members: members,
  memberNames: names,
  lastOutcome: lastOutcome,
  onPhone: onPhone,
  conflicts: conflicts,
);

final booth = [
  summary(
    'h-1',
    '12/4 Gandhi Road',
    members: 4,
    names: ['Synthetic Lakshmi'],
    lastOutcome: 'follow_up_requested',
    onPhone: 1,
  ),
  summary('h-2', '14 Gandhi Road', lastOutcome: 'completed'),
  summary('h-3', '15A Gandhi Road', members: 5, names: ['Synthetic Arjun']),
  summary(
    'h-4',
    '16 Gandhi Road',
    members: 2,
    lastOutcome: 'completed',
    conflicts: 1,
  ),
  summary('h-5', '2 Lane 3, Nehru Nagar', members: 6),
];

void main() {
  group('the list’s rows come from the local database', () {
    // A real clock: Drift watches don't settle on a widget test's fake clock.
    late Directory dir;
    late LocalStore store;
    late AppDatabase db;

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_households_test');
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

    Future<void> household(String id, {String status = 'active'}) => db
        .into(db.households)
        .insert(
          HouseholdsCompanion.insert(
            id: id,
            partId: 'part-1',
            pollingStationId: 'station-1',
            displayAddress: '$id Synthetic Street',
            houseKey: id,
            origin: 'official_import',
            status: status,
          ),
        );

    Future<void> voter(
      String id,
      String householdId,
      String name, {
      String status = 'active',
    }) => db
        .into(db.voters)
        .insert(
          VotersCompanion.insert(
            id: id,
            householdId: householdId,
            partId: 'part-1',
            pollingStationId: 'station-1',
            origin: 'official_import',
            recordStatus: status,
            official: '{"name":"$name","age":40}',
            previousVoterIds: const [],
          ),
        );

    Future<void> visit(
      String clientId,
      String householdId,
      String outcome, {
      required int day,
      String? serverId,
    }) => db
        .into(db.visits)
        .insert(
          VisitsCompanion.insert(
            clientId: clientId,
            serverId: Value(serverId),
            householdId: householdId,
            volunteerId: 'u-1',
            startedAt: DateTime.utc(2026, 9, day),
            outcome: outcome,
            formVersion: '1',
            memberIdsMet: const [],
          ),
        );

    Future<void> nameValue(
      String id,
      String voterId,
      String value, {
      String? conflictWith,
    }) => db
        .into(db.fieldValues)
        .insert(
          FieldValuesCompanion.insert(
            id: id,
            entityType: 'voter',
            entityId: voterId,
            fieldKey: 'name',
            value: '"$value"',
            sourceType: 'volunteer_collected',
            collectedAt: DateTime.utc(2026, 9, 20),
            isCurrent: true,
            conflictWithId: Value(conflictWith),
          ),
        );

    test('members, names, last outcome, and what’s on the phone', () async {
      await household('h-1');
      await household('h-2');
      await household('h-3');
      await household('h-9', status: 'removed');
      await voter('v-1', 'h-1', 'Synthetic Person One');
      await voter('v-2', 'h-1', 'Synthetic Person Two');
      await voter('v-3', 'h-1', 'Synthetic Gone', status: 'deleted');
      await voter('v-4', 'h-2', 'Synthetic Person Four');
      await nameValue('fv-1', 'v-1', 'Synthetic Corrected');
      // h-1: an uploaded visit, then a later one still on the phone.
      await visit('c-1', 'h-1', 'completed', day: 10, serverId: 'visit-1');
      await visit('c-2', 'h-1', 'follow_up_requested', day: 20);
      // h-2: uploaded, and a detail someone else also changed.
      await visit('c-3', 'h-2', 'completed', day: 15, serverId: 'visit-3');
      await nameValue('fv-2', 'v-4', 'Synthetic A', conflictWith: 'fv-3');
      // h-3: a queued change that is in conflict.
      await db
          .into(db.pendingMutations)
          .insert(
            PendingMutationsCompanion.insert(
              key: 'mutation-0001',
              type: 'household.update',
              payload: '{}',
              householdId: const Value('h-3'),
              status: const Value('conflict'),
              createdAt: DateTime.utc(2026, 9, 21),
            ),
          );

      // h-2: a queued change too, not in conflict.
      await db
          .into(db.pendingMutations)
          .insert(
            PendingMutationsCompanion.insert(
              key: 'mutation-0002',
              type: 'field.change',
              payload: '{}',
              householdId: const Value('h-2'),
              createdAt: DateTime.utc(2026, 9, 21),
            ),
          );
      // h-4: a detail of the household itself in conflict.
      await household('h-4');
      await db
          .into(db.fieldValues)
          .insert(
            FieldValuesCompanion.insert(
              id: 'fv-4',
              entityType: 'household',
              entityId: 'h-4',
              fieldKey: 'landmark',
              value: '"Synthetic landmark"',
              sourceType: 'volunteer_collected',
              collectedAt: DateTime.utc(2026, 9, 20),
              isCurrent: true,
              conflictWithId: const Value('fv-5'),
            ),
          );

      final rows = {
        for (final h in await db.watchHouseholdSummaries().first) h.id: h,
      };
      expect(rows.keys, unorderedEquals(['h-1', 'h-2', 'h-3', 'h-4']));
      expect(rows['h-4']!.conflicts, 1);
      expect(rows['h-2']!.onPhone, 1);

      final h1 = rows['h-1']!;
      expect(h1.members, 2);
      expect(
        h1.memberNames,
        containsAll([
          'Synthetic Person One',
          'Synthetic Person Two',
          'Synthetic Corrected',
        ]),
      );
      expect(h1.memberNames, isNot(contains('Synthetic Gone')));
      expect(h1.lastOutcome, 'follow_up_requested');
      expect(h1.visitStatus, VisitStatus.followUp);
      expect(h1.onPhone, 1);
      expect(h1.sync, HouseholdSync.onPhone);

      final h2 = rows['h-2']!;
      expect(h2.visitStatus, VisitStatus.visited);
      expect(h2.conflicts, 1);
      expect(h2.sync, HouseholdSync.chooseValue);

      final h3 = rows['h-3']!;
      expect(h3.members, 0);
      // A change in conflict is waiting on the volunteer, not on the upload.
      expect(h3.onPhone, 0);
      expect(h3.visitStatus, VisitStatus.notVisited);
      expect(h3.sync, HouseholdSync.chooseValue);
    });

    test('the list follows the database', () async {
      await household('h-1');
      final seen = <List<HouseholdSummary>>[];
      final sub = db.watchHouseholdSummaries().listen(seen.add);
      addTearDown(sub.cancel);
      await pumpEventQueue();
      expect(seen.last.single.visitStatus, VisitStatus.notVisited);

      await visit('c-1', 'h-1', 'completed', day: 10);
      await pumpEventQueue();
      expect(seen.last.single.visitStatus, VisitStatus.visited);
      expect(seen.last.single.onPhone, 1);
    });

    test('an uploaded visit with nothing else pending is Uploaded', () async {
      await household('h-1');
      await visit('c-1', 'h-1', 'completed', day: 10, serverId: 'visit-1');
      final h = (await db.watchHouseholdSummaries().first).single;
      expect(h.sync, HouseholdSync.uploaded);
      expect(h.onPhone, 0);
    });
  });

  group('rules', () {
    test('house numbers in the order people count them', () {
      final keys = ['16', '2', '12/4', '15A', '14', '3', '15'];
      keys.sort(compareHouseKeys);
      expect(keys, ['2', '3', '12/4', '14', '15', '15A', '16']);
    });

    test('search: address or any member’s name, any case', () {
      final h = summary(
        'h-1',
        '12/4 Gandhi Road',
        names: ['Synthetic Lakshmi'],
      );
      expect(h.matches('gandhi'), isTrue);
      expect(h.matches('LAKSH'), isTrue);
      expect(h.matches('  '), isTrue);
      expect(h.matches('Nehru'), isFalse);
    });

    test('the chip: a conflict, then on the phone, then uploaded', () {
      expect(summary('a', 'a').sync, isNull);
      expect(
        summary('a', 'a', lastOutcome: 'completed').sync,
        HouseholdSync.uploaded,
      );
      expect(summary('a', 'a', onPhone: 1).sync, HouseholdSync.onPhone);
      expect(
        summary('a', 'a', onPhone: 1, conflicts: 1).sync,
        HouseholdSync.chooseValue,
      );
    });
  });

  group('the households screen', () {
    late StreamController<List<HouseholdSummary>> rows;

    Future<void> show(
      WidgetTester tester, {
      List<HouseholdSummary>? households,
      TargetPlatform platform = TargetPlatform.android,
    }) async {
      rows = StreamController<List<HouseholdSummary>>();
      addTearDown(rows.close);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            householdSummariesProvider.overrideWith((ref) => rows.stream),
          ],
          child: MaterialApp(
            theme: AppTheme.light().copyWith(platform: platform),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HouseholdsScreen(),
          ),
        ),
      );
      rows.add(households ?? booth);
      await tester.pumpAndSettle();
    }

    List<String> addresses(WidgetTester tester) => tester
        .widgetList<ListTile>(find.byType(ListTile))
        .map((t) => (t.title! as Text).data!)
        .toList();

    testWidgets('every household, in house-number order, with its details', (
      tester,
    ) async {
      await show(tester);
      expect(addresses(tester), [
        '2 Lane 3, Nehru Nagar',
        '12/4 Gandhi Road',
        '14 Gandhi Road',
        '15A Gandhi Road',
        '16 Gandhi Road',
      ]);
      expect(find.text('4 members · Come back later'), findsOneWidget);
      expect(find.text('3 members · Met the family'), findsOneWidget);
      expect(find.text('5 members · Not visited'), findsOneWidget);
    });

    testWidgets('the status chips: word and icon', (tester) async {
      await show(tester);
      Finder chipIn(String address) => find.descendant(
        of: find.widgetWithText(ListTile, address),
        matching: find.byType(Text),
      );
      bool rowHas(String address, String word) =>
          tester.widgetList<Text>(chipIn(address)).any((t) => t.data == word);
      expect(rowHas('12/4 Gandhi Road', 'On phone'), isTrue);
      expect(rowHas('14 Gandhi Road', 'Uploaded'), isTrue);
      expect(rowHas('16 Gandhi Road', 'Choose value'), isTrue);
      // Not visited, nothing on the phone: no chip.
      expect(
        find.descendant(
          of: find.widgetWithText(ListTile, '15A Gandhi Road'),
          matching: find.byType(SyncStatusChip),
        ),
        findsNothing,
      );
      expect(find.byIcon(Icons.phone_android), findsOneWidget);
      expect(find.byIcon(Icons.cloud_done_outlined), findsOneWidget);
      expect(find.byIcon(Icons.call_split), findsOneWidget);
    });

    testWidgets('search by address or member name', (tester) async {
      await show(tester);
      await tester.enterText(find.byType(TextField), 'nehru');
      await tester.pumpAndSettle();
      expect(addresses(tester), ['2 Lane 3, Nehru Nagar']);

      await tester.enterText(find.byType(TextField), 'arjun');
      await tester.pumpAndSettle();
      expect(addresses(tester), ['15A Gandhi Road']);
    });

    testWidgets('filters, with a count on each', (tester) async {
      await show(tester);
      expect(find.text('All 5'), findsOneWidget);
      expect(find.text('Not visited 2'), findsOneWidget);
      expect(find.text('Visited 2'), findsOneWidget);
      expect(find.text('Follow-up 1'), findsOneWidget);

      await tester.tap(find.text('Not visited 2'));
      await tester.pumpAndSettle();
      expect(addresses(tester), ['2 Lane 3, Nehru Nagar', '15A Gandhi Road']);
      await tester.tap(find.text('Follow-up 1'));
      await tester.pumpAndSettle();
      expect(addresses(tester), ['12/4 Gandhi Road']);
      await tester.tap(find.text('Visited 2'));
      await tester.pumpAndSettle();
      expect(addresses(tester), ['14 Gandhi Road', '16 Gandhi Road']);

      // Search and filter together.
      await tester.enterText(find.byType(TextField), '16');
      await tester.pumpAndSettle();
      expect(addresses(tester), ['16 Gandhi Road']);
    });

    testWidgets('filter chips say what they are to screen readers', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await show(tester);
      expect(
        tester.getSemantics(find.bySemanticsLabel('Visited: 2 households')),
        isSemantics(isButton: true, isSelected: false),
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel('All: 5 households')),
        isSemantics(isButton: true, isSelected: true),
      );
      handle.dispose();
    });

    testWidgets('no match says so, and clearing shows everyone again', (
      tester,
    ) async {
      await show(tester);
      await tester.tap(find.text('Visited 2'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'nehru');
      await tester.pumpAndSettle();
      expect(find.text('No households match'), findsOneWidget);
      expect(find.byType(ListTile), findsNothing);

      await tester.tap(
        find.widgetWithText(OutlinedButton, 'Clear search and filter'),
      );
      await tester.pumpAndSettle();
      expect(addresses(tester), hasLength(5));
      expect(find.text('All 5'), findsOneWidget);
    });

    testWidgets('an empty booth says so', (tester) async {
      await show(tester, households: const []);
      expect(find.text('No households yet'), findsOneWidget);
      expect(find.text('No households match'), findsNothing);
    });

    testWidgets('Add household: a floating button on Android', (tester) async {
      await show(tester);
      expect(
        find.widgetWithText(FloatingActionButton, 'Add household'),
        findsOneWidget,
      );
      expect(find.widgetWithText(TextButton, 'Add'), findsNothing);
    });

    testWidgets('Add: in the header on iOS', (tester) async {
      await show(tester, platform: TargetPlatform.iOS);
      expect(find.byType(FloatingActionButton), findsNothing);
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.widgetWithText(TextButton, 'Add'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('in Telugu', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            householdSummariesProvider.overrideWith(
              (ref) => Stream.value([booth.first]),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light(),
            locale: const Locale('te'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HouseholdsScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('4 సభ్యులు'), findsOneWidget);
    });
  });

  group('in the app', () {
    testWidgets('a row opens its household; Add opens the new household', (
      tester,
    ) async {
      final container = await startApp(
        tester,
        api: FakeAuthApi(session: true),
        overrides: [
          householdSummariesProvider.overrideWith((ref) => Stream.value(booth)),
        ],
      );
      await go(tester, container, '/households');
      await tester.tap(find.text('14 Gandhi Road'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<HouseholdScreen>(find.byType(HouseholdScreen))
            .householdId,
        'h-2',
      );
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add household'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(AppBar, 'New household'), findsOneWidget);
    }, variant: TargetPlatformVariant.only(TargetPlatform.android));
  });
}
