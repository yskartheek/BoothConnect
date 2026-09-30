import 'dart:async';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/sync/sync_repository.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/sync/sync_controller.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/fake_sync_api.dart';

Map<String, dynamic> snapshot(String cursor, String householdId) => syncPage(
  cursor: cursor,
  reset: true,
  households: [
    {
      'id': householdId,
      'partId': 'part-1',
      'pollingStationId': 'station-1',
      'displayAddress': 'Synthetic Street',
      'houseKey': '1',
      'structuredAddress': null,
      'location': null,
      'origin': 'official_import',
      'status': 'active',
    },
  ],
);

bool idle(ProviderContainer c) =>
    c.read(syncControllerProvider).phase != SyncPhase.syncing;

Future<AppDatabase> database(WidgetTester tester, ProviderContainer c) =>
    settle(tester, c.read(appDatabaseProvider.future));

Future<List<String>> householdIds(
  WidgetTester tester,
  ProviderContainer c,
) async {
  final db = await database(tester, c);
  final rows = await settle(tester, db.select(db.households).get());
  return rows.map((h) => h.id).toList();
}

/// The app goes to the background and comes back, through every state
/// Flutter expects on the way.
void backgroundAndResume(WidgetTester tester) {
  for (final state in [
    AppLifecycleState.inactive,
    AppLifecycleState.hidden,
    AppLifecycleState.paused,
    AppLifecycleState.hidden,
    AppLifecycleState.inactive,
    AppLifecycleState.resumed,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(state);
  }
}

void main() {
  testWidgets('a stored session pulls when the app opens', (tester) async {
    final sync = FakeSyncApi([snapshot('c-1', 'h-1')]);
    final c = await startApp(
      tester,
      api: FakeAuthApi(session: true),
      syncApi: sync,
    );
    await waitFor(tester, () => sync.calls.isNotEmpty && idle(c));
    expect(sync.calls, [null]);
    expect(await householdIds(tester, c), ['h-1']);
    expect(c.read(syncControllerProvider).lastPullAt, isNotNull);
  });

  testWidgets('signing in pulls, and a signed-out app doesn’t', (tester) async {
    final sync = FakeSyncApi([snapshot('c-1', 'h-1')]);
    final c = await startApp(tester, syncApi: sync);
    // Signed out: resuming the app pulls nothing.
    backgroundAndResume(tester);
    await tester.pump();
    expect(sync.calls, isEmpty);

    await signInThroughScreen(tester);
    await waitFor(tester, () => sync.calls.isNotEmpty && idle(c));
    expect(await householdIds(tester, c), ['h-1']);
    final db = await database(tester, c);
    expect(await settle(tester, SyncRepository(db, sync).owner()), 'u-1');
  });

  testWidgets('another volunteer’s data is wiped when someone else signs in', (
    tester,
  ) async {
    final sync = FakeSyncApi([snapshot('c-1', 'h-mine')]);
    final c = await startApp(tester, syncApi: sync);
    // Left by a volunteer whose session ended without a sign-out.
    final db = await database(tester, c);
    await settle(tester, () async {
      final previous = SyncRepository(db, sync);
      await previous.setOwner('u-other');
      // They had pulled: their cursor would ask for a delta on their data.
      await db
          .into(db.syncMeta)
          .insert(
            SyncMetaCompanion.insert(
              key: SyncRepository.cursorKey,
              value: 'c-theirs',
            ),
          );
      await db
          .into(db.households)
          .insert(
            HouseholdsCompanion.insert(
              id: 'h-theirs',
              partId: 'part-9',
              pollingStationId: 'station-9',
              displayAddress: 'Their Street',
              houseKey: '9',
              origin: 'official_import',
              status: 'active',
            ),
          );
    }());

    await signInThroughScreen(tester);
    await waitFor(tester, () => sync.calls.isNotEmpty && idle(c));
    expect(await householdIds(tester, c), ['h-mine']);
    // A fresh snapshot, from the start.
    expect(sync.calls, [null]);
  });

  testWidgets('the same volunteer signing in again keeps their data', (
    tester,
  ) async {
    final sync = FakeSyncApi([snapshot('c-1', 'h-1'), syncPage(cursor: 'c-2')]);
    final c = await startApp(tester, syncApi: sync);
    await signInThroughScreen(tester);
    await waitFor(tester, () => sync.calls.length == 1 && idle(c));

    // The session ends (no sign-out), and the same volunteer signs in.
    c.read(authProvider.notifier).sessionEnded();
    await tester.pumpAndSettle();
    await signInThroughScreen(tester);
    await waitFor(tester, () => sync.calls.length == 2 && idle(c));
    // Not wiped: a delta pull from the saved cursor.
    expect(sync.calls, [null, 'c-1']);
    expect(await householdIds(tester, c), ['h-1']);
  });

  testWidgets('resuming the app pulls', (tester) async {
    final sync = FakeSyncApi();
    final c = await startApp(
      tester,
      api: FakeAuthApi(session: true),
      syncApi: sync,
    );
    await waitFor(tester, () => sync.calls.length == 1 && idle(c));
    backgroundAndResume(tester);
    await waitFor(tester, () => sync.calls.length == 2 && idle(c));
    expect(sync.calls, hasLength(2));
  });

  testWidgets('coming back online pulls; staying online doesn’t', (
    tester,
  ) async {
    final network = StreamController<List<ConnectivityResult>>();
    addTearDown(network.close);
    final sync = FakeSyncApi();
    final c = await startApp(
      tester,
      api: FakeAuthApi(session: true),
      syncApi: sync,
      connectivity: network.stream,
    );
    await waitFor(tester, () => sync.calls.length == 1 && idle(c));

    network.add([ConnectivityResult.wifi]);
    await tester.pump();
    expect(sync.calls, hasLength(1));
    network.add([ConnectivityResult.none]);
    await tester.pump();
    network.add([ConnectivityResult.mobile]);
    await waitFor(tester, () => sync.calls.length == 2 && idle(c));
    expect(sync.calls, hasLength(2));
  });

  testWidgets('offline: the state says so and the data stays', (tester) async {
    final sync = FakeSyncApi([snapshot('c-1', 'h-1')]);
    final c = await startApp(
      tester,
      api: FakeAuthApi(session: true),
      syncApi: sync,
    );
    await waitFor(tester, () => sync.calls.length == 1 && idle(c));

    sync.pages.add(offline);
    await settle(tester, c.read(syncControllerProvider.notifier).pullNow());
    expect(c.read(syncControllerProvider).phase, SyncPhase.offline);
    expect(await householdIds(tester, c), ['h-1']);
    // The last successful pull is still known.
    expect(c.read(syncControllerProvider).lastPullAt, isNotNull);
  });

  testWidgets('pulls requested together run once', (tester) async {
    final sync = FakeSyncApi();
    final c = await startApp(
      tester,
      api: FakeAuthApi(session: true),
      syncApi: sync,
    );
    await waitFor(tester, () => sync.calls.length == 1 && idle(c));

    final controller = c.read(syncControllerProvider.notifier);
    await settle(
      tester,
      Future.wait([
        controller.pullNow(),
        controller.pullNow(),
        controller.pullNow(),
      ]),
    );
    expect(sync.calls, hasLength(2));
  });
}
