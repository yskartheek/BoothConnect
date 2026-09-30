import 'package:boothconnect_mobile/app/router.dart';
import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/auth/sign_in_screen.dart';
import 'package:boothconnect_mobile/features/households/household_screen.dart';
import 'package:boothconnect_mobile/features/visit/visit_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/app_harness.dart';
import 'support/fake_auth_api.dart';
import 'support/memory_secrets.dart';

void main() {
  testWidgets('a signed-out user is redirected to sign-in', (tester) async {
    final container = await startApp(tester);

    expect(location(container), '/sign-in');
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Your booth'), findsNothing);

    // Every other page is closed too.
    for (final path in [
      '/households',
      '/household/h-1',
      '/visit/h-1',
      '/sync',
    ]) {
      await go(tester, container, path);
      expect(find.byType(SignInScreen), findsOneWidget, reason: path);
    }
  });

  testWidgets('after signing in, the app opens the page that was asked for', (
    tester,
  ) async {
    final container = await startApp(tester);
    await go(tester, container, '/household/h-1');
    expect(location(container), '/sign-in?from=%2Fhousehold%2Fh-1');

    await signInThroughScreen(tester);
    expect(location(container), '/household/h-1');
    final screen = tester.widget<HouseholdScreen>(find.byType(HouseholdScreen));
    expect(screen.householdId, 'h-1');
  });

  testWidgets('signed in, sign-in goes on to home', (tester) async {
    final container = await startApp(tester, api: FakeAuthApi(session: true));
    expect(location(container), '/');
    expect(find.text('Your booth'), findsOneWidget);

    await go(tester, container, '/sign-in');
    expect(location(container), '/');
  });

  testWidgets('every route opens its placeholder screen', (tester) async {
    final container = await startApp(tester, api: FakeAuthApi(session: true));
    for (final (path, title) in [
      ('/households/new', 'New household'),
      ('/household/h-1', 'Household'),
      ('/visit/h-2', 'Visit'),
      ('/sync', 'Uploads'),
    ]) {
      await go(tester, container, path);
      expect(find.widgetWithText(AppBar, title), findsOneWidget, reason: path);
      expect(find.text('This screen is being built.'), findsOneWidget);
      if (path.startsWith('/visit/')) {
        final visit = tester.widget<VisitScreen>(find.byType(VisitScreen));
        expect(visit.householdId, 'h-2');
      }
    }
  });

  testWidgets('home opens households and uploads, and back returns', (
    tester,
  ) async {
    final container = await startApp(tester, api: FakeAuthApi(session: true));

    await tester.tap(find.text('Households'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Households'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(location(container), '/');

    await tester.tap(find.widgetWithText(OutlinedButton, 'Uploads'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Uploads'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('Your booth'), findsOneWidget);
  });

  testWidgets('signing out wipes the phone and goes back to sign-in', (
    tester,
  ) async {
    final api = FakeAuthApi(session: true);
    final container = await startApp(tester, api: api);
    final store = container.read(localStoreProvider);
    final file = await tester.runAsync(() async {
      final db = await store.open();
      await db
          .into(db.syncMeta)
          .insert(SyncMetaCompanion.insert(key: 'test-marker', value: '1'));
      return store.file();
    });
    expect(file!.existsSync(), isTrue);

    final secrets = container.read(secretStoreProvider) as MemorySecrets;
    expect(secrets.values, contains(DatabaseKeyStore.secretName));

    await tester.tap(find.byTooltip('Sign out'));
    // Signed out at once; the wipe follows. It deletes the file (and its
    // -wal, -shm) before the key, so wait for the key too.
    await waitFor(
      tester,
      () =>
          container.read(authProvider) == AuthStatus.signedOut &&
          !file.existsSync() &&
          !secrets.values.containsKey(DatabaseKeyStore.secretName),
    );
    expect(location(container), '/sign-in');
    expect(container.read(authProvider), AuthStatus.signedOut);
    expect(file.existsSync(), isFalse);
    // No new database was opened behind the sign-out: no key left either.
    expect(await secrets.read(DatabaseKeyStore.secretName), isNull);
    expect(api.logouts, 1);
  });

  testWidgets('an unknown link says so and leads home', (tester) async {
    final container = await startApp(tester, api: FakeAuthApi(session: true));
    await go(tester, container, '/no-such-page');
    expect(find.text('Page not found'), findsOneWidget);
    await tester.tap(find.text('Go to home'));
    await tester.pumpAndSettle();
    expect(location(container), '/');
  });

  testWidgets('a stored session opens the app signed in', (tester) async {
    final container = await startApp(tester, api: FakeAuthApi(session: true));
    expect(location(container), '/');
    expect(container.read(authProvider), AuthStatus.signedIn);
  });

  testWidgets('an ended session goes to sign-in and keeps the data', (
    tester,
  ) async {
    final container = await startApp(tester, api: FakeAuthApi(session: true));
    final store = container.read(localStoreProvider);
    final file = await tester.runAsync(() async {
      final db = await store.open();
      await db
          .into(db.syncMeta)
          .insert(SyncMetaCompanion.insert(key: 'test-marker', value: '1'));
      return store.file();
    });
    expect(file!.existsSync(), isTrue);
    container.read(authProvider.notifier).sessionEnded();
    await tester.pumpAndSettle();
    expect(location(container), '/sign-in');
    // Changes not yet uploaded may be in there.
    expect(file.existsSync(), isTrue);
  });

  for (final brightness in Brightness.values) {
    testWidgets('the theme follows the phone: ${brightness.name}', (
      tester,
    ) async {
      tester.platformDispatcher.platformBrightnessTestValue = brightness;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await startApp(tester);
      final context = tester.element(find.byType(SignInScreen));
      expect(Theme.of(context).brightness, brightness);
    });
  }

  group('authRedirect', () {
    Uri u(String s) => Uri.parse(s);

    test('starting: wait, remembering the page', () {
      expect(authRedirect(AuthStatus.starting, u('/')), '/starting');
      expect(
        authRedirect(AuthStatus.starting, u('/sync')),
        '/starting?from=%2Fsync',
      );
      expect(authRedirect(AuthStatus.starting, u('/starting')), isNull);
      // Then on to sign-in or the page, keeping `from`.
      expect(
        authRedirect(AuthStatus.signedOut, u('/starting?from=%2Fsync')),
        '/sign-in?from=%2Fsync',
      );
      expect(
        authRedirect(AuthStatus.signedIn, u('/starting?from=%2Fsync')),
        '/sync',
      );
    });

    test('signed out: to sign-in, remembering the page', () {
      expect(authRedirect(AuthStatus.signedOut, u('/')), '/sign-in');
      expect(
        authRedirect(AuthStatus.signedOut, u('/visit/h-1')),
        '/sign-in?from=%2Fvisit%2Fh-1',
      );
      expect(authRedirect(AuthStatus.signedOut, u('/sign-in')), isNull);
    });

    test('signed in: on from sign-in, only to a page of this app', () {
      expect(authRedirect(AuthStatus.signedIn, u('/sync')), isNull);
      expect(authRedirect(AuthStatus.signedIn, u('/sign-in')), '/');
      expect(
        authRedirect(AuthStatus.signedIn, u('/sign-in?from=%2Fsync')),
        '/sync',
      );
      for (final from in [
        'https://example.com',
        '//example.com',
        'sync',
        '/sign-in',
        '/starting',
      ]) {
        final uri = Uri(path: '/sign-in', queryParameters: {'from': from});
        expect(authRedirect(AuthStatus.signedIn, uri), '/', reason: from);
      }
    });
  });
}
