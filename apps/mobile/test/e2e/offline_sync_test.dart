import 'dart:async';
import 'dart:io';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/sync/sync_controller.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/drift.dart' show OrderingTerm, Value;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_api_server.dart';
import '../support/memory_secrets.dart';

// End to end, as on a phone (plan §8, Mobile): the app over real HTTP
// against a stand-in API, its encrypted database on disk, and a restart in
// the middle. "Offline" is both the phone's connection state and the server
// dropping every connection. Synthetic data only.

Future<List<PendingMutationRow>> queued(
  WidgetTester tester,
  ProviderContainer app,
) async {
  final db = await settle(tester, app.read(appDatabaseProvider.future));
  return settle(
    tester,
    (db.select(
      db.pendingMutations,
    )..orderBy([(t) => OrderingTerm(expression: t.id)])).get(),
  );
}

void main() {
  late FakeApiServer server;
  late Directory dir;
  late MemorySecrets secrets;

  setUp(() {
    // flutter_test answers every HTTP request with 400; this test talks to
    // a real (local) server.
    HttpOverrides.global = null;
    dir = Directory.systemTemp.createTempSync('bc_e2e');
    secrets = MemorySecrets();
  });

  testWidgets('offline visit → restart → still waiting → reconnect → synced', (
    tester,
  ) async {
    server = (await tester.runAsync(FakeApiServer.start))!;
    addTearDown(() => tester.runAsync(server.close));
    addTearDown(() => dir.deleteSync(recursive: true));

    // --- Sign in, online, and download the booth. -------------------------
    final network1 = StreamController<List<ConnectivityResult>>.broadcast();
    addTearDown(network1.close);
    final app1 = await startApp(
      tester,
      apiBaseUrl: server.baseUrl,
      connectivity: network1.stream,
      directory: dir,
      secrets: secrets,
    );
    network1.add([ConnectivityResult.wifi]);
    await waitFor(tester, () => find.text('Send code').evaluate().isNotEmpty);
    await signInThroughScreen(tester);
    expect(app1.read(authProvider), AuthStatus.signedIn);
    await go(tester, app1, '/households');
    await waitFor(
      tester,
      () => find.text(FakeApiServer.address).evaluate().isNotEmpty,
    );

    // --- Go offline and record a visit. -----------------------------------
    server.down = true;
    network1.add([ConnectivityResult.none]);
    await tester.pumpAndSettle();
    await tester.tap(find.text(FakeApiServer.address));
    await waitFor(tester, () => find.text('Start visit').evaluate().isNotEmpty);
    await tester.tap(find.text('Start visit'));
    await waitFor(tester, () => find.text('No one home').evaluate().isNotEmpty);
    await tester.tap(find.text('No one home'));
    await waitFor(tester, () => find.text('On phone').evaluate().isNotEmpty);
    final before = await queued(tester, app1);
    expect(before.map((m) => (m.type, m.status)), [
      ('visit.create', 'pending'),
    ]);
    final key = before.single.key;
    expect(server.visits, isEmpty);

    // --- Restart: the app closes; it opens again, still offline. ----------
    await stopApp(app1);
    final network2 = StreamController<List<ConnectivityResult>>.broadcast();
    addTearDown(network2.close);
    final app2 = await startApp(
      tester,
      apiBaseUrl: server.baseUrl,
      connectivity: network2.stream,
      directory: dir,
      secrets: secrets,
    );
    network2.add([ConnectivityResult.none]);
    // The stored session signs in by itself.
    await waitFor(tester, () => app2.read(authProvider) == AuthStatus.signedIn);
    // The opening sync can't reach the server; the visit is still waiting.
    await settle(tester, app2.read(syncControllerProvider.notifier).whenIdle());
    final after = await queued(tester, app2);
    expect(after.single.key, key);
    expect(after.single.type, 'visit.create');
    expect(after.single.status, 'pending');
    expect(server.visits, isEmpty);

    await go(tester, app2, '/sync');
    await waitFor(
      tester,
      () => find.text('Offline · 1 waiting').evaluate().isNotEmpty,
    );
    expect(find.text('Offline · 1 waiting'), findsOneWidget);
    expect(find.text('Visit · ${FakeApiServer.address}'), findsOneWidget);

    // Offline a long time: its next try is an hour away.
    final db2 = await settle(tester, app2.read(appDatabaseProvider.future));
    await settle(
      tester,
      db2
          .update(db2.pendingMutations)
          .write(
            PendingMutationsCompanion(
              nextAttemptAt: Value(
                DateTime.now().add(const Duration(hours: 1)),
              ),
            ),
          ),
    );

    // --- Back online: it uploads at once and shows as synced. -------------
    server.down = false;
    network2.add([ConnectivityResult.wifi]);
    await waitFor(tester, () => server.visits.isNotEmpty);
    await waitFor(
      tester,
      () => find.text('Online · everything uploaded').evaluate().isNotEmpty,
    );
    expect(find.text('Online · everything uploaded'), findsOneWidget);
    expect(await queued(tester, app2), isEmpty);

    // Stored once, under the phone's own key and visit id.
    final visit = server.visits.values.single;
    expect(visit['outcome'], 'no_one_available');
    expect(visit['householdId'], FakeApiServer.householdId);
    expect({for (final p in server.pushes) ...p.$2}, {key});
    expect(server.pushes.map((p) => p.$1), everyElement(isNotNull));

    // The household shows it: visited, and Uploaded.
    await go(tester, app2, '/households');
    await waitFor(tester, () => find.text('Uploaded').evaluate().isNotEmpty);
    expect(find.text('Uploaded'), findsOneWidget);
    final db = await settle(tester, app2.read(appDatabaseProvider.future));
    final local = await settle(tester, db.select(db.visits).getSingle());
    expect(local.clientId, visit['clientId']);
    expect(local.serverId, visit['id']);

    // Close the app; the HTTP client's timeout timers run out.
    await settle(tester, app2.read(syncControllerProvider.notifier).whenIdle());
    await stopApp(app2);
    await tester.pump(const Duration(minutes: 1));
  });
}
