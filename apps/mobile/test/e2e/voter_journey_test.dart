import 'dart:async';
import 'dart:io';

import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/sync/sync_controller.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_api_server.dart';
import '../support/fake_auth_api.dart' show goodCode;
import '../support/memory_secrets.dart';

// The voter prototype end to end (#229), as on a shared phone: the app over
// real HTTP against a stand-in API. A voter signs in, edits their
// occupation and sees it in Updates; then the booth volunteer signs in on
// the same phone and their download has the new value, as the voter's. The
// real API's side of the same journey is apps/api/test/voter-journey.
// Synthetic data only.

void main() {
  setUp(() {
    // flutter_test answers every HTTP request with 400; this test talks to
    // a real (local) server.
    HttpOverrides.global = null;
  });

  Future<void> tab(WidgetTester tester, String label) async {
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text(label),
      ),
    );
    // Not pumpAndSettle: the loading spinner would run the test's clock on
    // until the request timed out, before the real reply arrives.
    await tester.pump();
  }

  testWidgets(
    'voter edits occupation → Updates → the volunteer’s pull has it',
    (tester) async {
      final server = (await tester.runAsync(FakeApiServer.start))!;
      addTearDown(() => tester.runAsync(server.close));
      final dir = Directory.systemTemp.createTempSync('bc_voter_e2e');
      addTearDown(() => dir.deleteSync(recursive: true));
      final network = StreamController<List<ConnectivityResult>>.broadcast();
      addTearDown(network.close);

      final app = await startApp(
        tester,
        apiBaseUrl: server.baseUrl,
        connectivity: network.stream,
        directory: dir,
        secrets: MemorySecrets(),
      );
      network.add([ConnectivityResult.wifi]);
      await waitFor(tester, () => find.text('Voter').evaluate().isNotEmpty);

      // --- The voter signs in with their voter ID and mobile on record. -----
      await tester.tap(find.text('Voter'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Voter ID (EPIC) number'),
        'syn 1000001',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Mobile number'),
        '99999 00101',
      );
      await tester.tap(find.text('Send code'));
      final signIn = find.widgetWithText(FilledButton, 'Sign in');
      await waitFor(tester, () => signIn.evaluate().isNotEmpty);
      await tester.enterText(find.byType(TextField), goodCode);
      await tester.tap(signIn);
      await waitFor(
        tester,
        () => find.text('Namaste, Synthetic Lakshmi').evaluate().isNotEmpty,
      );
      expect(app.read(authProvider), AuthStatus.voter);

      // --- They change their occupation. -----------------------------------
      await tab(tester, 'My details');
      await waitFor(tester, () => find.text('Teacher').evaluate().isNotEmpty);
      expect(find.text('Teacher'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Edit'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Occupation'),
        'Synthetic Weaver',
      );
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () =>
            find.text('Synthetic Weaver').evaluate().isNotEmpty &&
            find.text('Edit my details').evaluate().isEmpty,
      );
      expect(find.text('Saved.'), findsOneWidget);
      expect(server.editKeys, hasLength(1));
      expect(server.editKeys.single, isNotNull);
      expect(server.shared['occupation']?.value, 'Synthetic Weaver');

      // --- Updates shows it, without the value. -----------------------------
      await tab(tester, 'Updates');
      await waitFor(
        tester,
        () => find.text('You updated your occupation').evaluate().isNotEmpty,
      );
      expect(find.text('You started using the app'), findsOneWidget);
      expect(find.text('Synthetic Weaver'), findsNothing);

      // --- The voter signs out; the booth volunteer signs in. ---------------
      await tab(tester, 'Privacy');
      await waitFor(
        tester,
        () => find.text('Shared with your booth team').evaluate().isNotEmpty,
      );
      expect(find.text('Shared with your booth team'), findsOneWidget);
      final signOut = find.widgetWithText(OutlinedButton, 'Sign out');
      await tester.scrollUntilVisible(
        signOut,
        100,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(signOut);
      await tester.pump();
      await tester.tap(signOut);
      await waitFor(tester, () => find.text('Send code').evaluate().isNotEmpty);
      expect(app.read(authProvider), AuthStatus.signedOut);
      await signInThroughScreen(tester);
      expect(app.read(authProvider), AuthStatus.signedIn);

      // Their download has the voter's value, marked as the voter's.
      final db = await settle(tester, app.read(appDatabaseProvider.future));
      var rows = await settle(tester, db.select(db.fieldValues).get());
      // The first download runs after sign-in; wait for it to land.
      for (
        var i = 0;
        i < 100 && !rows.any((r) => r.fieldKey == 'occupation');
        i++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pump();
        rows = await settle(tester, db.select(db.fieldValues).get());
      }
      final occupation = rows.singleWhere((r) => r.fieldKey == 'occupation');
      expect(occupation.entityId, FakeApiServer.voterId);
      expect(occupation.value, contains('Synthetic Weaver'));
      expect(occupation.sourceType, 'voter_self_submitted');

      // Close the app; the HTTP client's timeout timers run out.
      await settle(
        tester,
        app.read(syncControllerProvider.notifier).whenIdle(),
      );
      await stopApp(app);
      await tester.pump(const Duration(minutes: 1));
    },
  );
}
