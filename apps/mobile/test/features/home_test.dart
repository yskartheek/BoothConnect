import 'dart:async';
import 'dart:io';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/sync/sync_repository.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/home/home_screen.dart';
import 'package:boothconnect_mobile/features/sync/sync_controller.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_sync_api.dart';
import '../support/memory_secrets.dart';

// Synthetic data only.
HouseholdsCompanion household(String id, {String status = 'active'}) =>
    HouseholdsCompanion.insert(
      id: id,
      partId: 'part-1',
      pollingStationId: 'station-1',
      displayAddress: 'Synthetic Street',
      houseKey: id,
      origin: 'official_import',
      status: status,
    );

VisitsCompanion visit(
  String clientId,
  String householdId, {
  String? serverId,
}) => VisitsCompanion.insert(
  clientId: clientId,
  serverId: serverId == null ? const Value.absent() : Value(serverId),
  householdId: householdId,
  volunteerId: 'u-1',
  startedAt: DateTime.utc(2026, 9, 30, 9),
  outcome: 'completed',
  formVersion: '1',
  memberIdsMet: const [],
);

PendingMutationsCompanion mutation(String key) =>
    PendingMutationsCompanion.insert(
      key: key,
      type: 'visit.create',
      payload: '{}',
      createdAt: DateTime.utc(2026, 9, 30, 9),
    );

class _SignedIn extends AuthController {
  @override
  AuthStatus build() => AuthStatus.signedIn;
}

void main() {
  group('the home figures come from the local database', () {
    // A real clock, as on a phone: Drift watches don't settle on a widget
    // test's fake clock.
    late Directory dir;
    late LocalStore store;
    late ProviderContainer container;
    late AppDatabase db;

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_home_test');
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(MemorySecrets()),
        inBackground: false,
      );
      container = ProviderContainer(
        overrides: [
          localStoreProvider.overrideWithValue(store),
          authProvider.overrideWith(_SignedIn.new),
        ],
      );
      db = await container.read(appDatabaseProvider.future);
    });
    tearDown(() async {
      container.dispose();
      await store.wipe();
      dir.deleteSync(recursive: true);
    });

    /// The provider's latest value, once the watch has caught up.
    Future<T> latest<T>(StreamProvider<T> provider) async {
      final values = <T>[];
      final sub = container.listen(provider, (_, next) {
        if (next.hasValue) values.add(next.value as T);
      }, fireImmediately: true);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      sub.close();
      return values.last;
    }

    test('booth, households on the roll and those visited', () async {
      await SyncRepository(db, FakeSyncApi()).setBooths(const [
        BoothAssignment(name: 'Demo Primary School', code: '1'),
      ]);
      for (final id in ['h-1', 'h-2', 'h-3']) {
        await db.into(db.households).insert(household(id));
      }
      await db.into(db.households).insert(household('h-9', status: 'removed'));
      // Two visits to h-1 (one uploaded, one on the phone), one to h-2, and
      // one to a household no longer on the roll.
      await db.into(db.visits).insert(visit('c-1', 'h-1', serverId: 'v-1'));
      await db.into(db.visits).insert(visit('c-2', 'h-1'));
      await db.into(db.visits).insert(visit('c-3', 'h-2'));
      await db.into(db.visits).insert(visit('c-4', 'h-9'));

      expect((await latest(boothsProvider)).single.name, 'Demo Primary School');
      expect(await latest(householdCountProvider), 3);
      expect(await latest(visitedCountProvider), 2);
    });

    test('the pending count updates when a change is queued', () async {
      final counts = <int>[];
      final sub = container.listen(pendingCountProvider, (_, next) {
        if (next.hasValue) counts.add(next.value!);
      }, fireImmediately: true);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await db.into(db.pendingMutations).insert(mutation('mutation-0001'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await db.into(db.pendingMutations).insert(mutation('mutation-0002'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      sub.close();
      expect(counts, [0, 1, 2]);
    });
  });

  group('the home screen', () {
    late StreamController<int> pending;
    late StreamController<List<ConnectivityResult>> network;

    Future<void> show(
      WidgetTester tester, {
      List<BoothAssignment> booths = const [
        BoothAssignment(name: 'Demo Primary School', code: '1'),
      ],
      int households = 10,
      int visited = 3,
      Locale locale = const Locale('en'),
    }) async {
      pending = StreamController<int>();
      network = StreamController<List<ConnectivityResult>>();
      addTearDown(pending.close);
      addTearDown(network.close);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            boothsProvider.overrideWith((ref) => Stream.value(booths)),
            householdCountProvider.overrideWith(
              (ref) => Stream.value(households),
            ),
            visitedCountProvider.overrideWith((ref) => Stream.value(visited)),
            pendingCountProvider.overrideWith((ref) => pending.stream),
            connectivityChangesProvider.overrideWithValue(network.stream),
          ],
          child: MaterialApp(
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HomeScreen(),
          ),
        ),
      );
      pending.add(0);
      await tester.pumpAndSettle();
    }

    testWidgets('shows the booth and the visit progress', (tester) async {
      await show(tester);
      expect(find.text('Your booth'), findsOneWidget);
      expect(find.text('Demo Primary School, booth 1'), findsOneWidget);
      expect(find.text('3 of 10 households visited'), findsOneWidget);
      final bar = tester.widget<LinearProgressIndicator>(
        find.byType(LinearProgressIndicator),
      );
      expect(bar.value, closeTo(0.3, 0.001));
      expect(find.text('Booth data not downloaded yet.'), findsOneWidget);
    });

    testWidgets('the badge follows the changes waiting to upload', (
      tester,
    ) async {
      await show(tester);
      expect(find.text('Everything is uploaded.'), findsOneWidget);
      expect(tester.widget<Badge>(find.byType(Badge)).isLabelVisible, isFalse);

      pending.add(2);
      await tester.pumpAndSettle();
      expect(find.text('Waiting to upload: 2'), findsOneWidget);
      final badge = tester.widget<Badge>(find.byType(Badge));
      expect(badge.isLabelVisible, isTrue);
      expect((badge.label! as Text).data, '2');

      pending.add(0);
      await tester.pumpAndSettle();
      expect(find.text('Everything is uploaded.'), findsOneWidget);
    });

    testWidgets('offline shows the banner; back online hides it', (
      tester,
    ) async {
      await show(tester);
      expect(find.text("You're offline"), findsNothing);
      network.add([ConnectivityResult.none]);
      await tester.pumpAndSettle();
      expect(find.text("You're offline"), findsOneWidget);
      network.add([ConnectivityResult.wifi]);
      await tester.pumpAndSettle();
      expect(find.text("You're offline"), findsNothing);
    });

    testWidgets('no booth yet, and no households', (tester) async {
      await show(tester, booths: const [], households: 0, visited: 0);
      expect(
        find.text('No booth assigned yet. Ask your coordinator.'),
        findsOneWidget,
      );
      expect(find.text('0 of 0 households visited'), findsOneWidget);
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .value,
        0,
      );
    });

    testWidgets('in Telugu', (tester) async {
      await show(tester, locale: const Locale('te'));
      expect(find.text('మీ బూత్'), findsOneWidget);
      expect(find.text('10 ఇళ్లలో 3 సందర్శించారు'), findsOneWidget);
    });
  });
}
