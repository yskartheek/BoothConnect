import 'dart:io';

import 'package:boothconnect_mobile/app/app.dart';
import 'package:boothconnect_mobile/app/router.dart';
import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/auth/sign_in_screen.dart';
import 'package:boothconnect_mobile/features/households/household_screen.dart';
import 'package:boothconnect_mobile/features/visit/visit_screen.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/memory_secrets.dart';

class _SignedIn extends AuthController {
  @override
  AuthStatus build() => AuthStatus.signedIn;
}

/// Starts the app, signed in or not, and returns its provider container.
Future<ProviderContainer> startApp(
  WidgetTester tester, {
  bool signedIn = false,
}) async {
  final dir = Directory.systemTemp.createTempSync('bc_app_test');
  final container = ProviderContainer(
    overrides: [
      if (signedIn) authProvider.overrideWith(_SignedIn.new),
      localStoreProvider.overrideWithValue(
        LocalStore(
          directory: () async => dir,
          keys: DatabaseKeyStore(MemorySecrets()),
          inBackground: false,
        ),
      ),
    ],
  );
  addTearDown(() async {
    await container.read(localStoreProvider).wipe();
    container.dispose();
    dir.deleteSync(recursive: true);
  });
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const BoothConnectApp(),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

String location(ProviderContainer container) => container
    .read(routerProvider)
    .routerDelegate
    .currentConfiguration
    .uri
    .toString();

Future<void> go(
  WidgetTester tester,
  ProviderContainer container,
  String path,
) async {
  container.read(routerProvider).go(path);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a signed-out user is redirected to sign-in', (tester) async {
    final container = await startApp(tester);

    expect(location(container), '/sign-in');
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Welcome to BoothConnect'), findsNothing);

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

    await tester.tap(find.text('Continue (development build)'));
    await tester.pumpAndSettle();
    expect(location(container), '/household/h-1');
    final screen = tester.widget<HouseholdScreen>(find.byType(HouseholdScreen));
    expect(screen.householdId, 'h-1');
  });

  testWidgets('signed in, sign-in goes on to home', (tester) async {
    final container = await startApp(tester, signedIn: true);
    expect(location(container), '/');
    expect(find.text('Welcome to BoothConnect'), findsOneWidget);

    await go(tester, container, '/sign-in');
    expect(location(container), '/');
  });

  testWidgets('every route opens its placeholder screen', (tester) async {
    final container = await startApp(tester, signedIn: true);
    for (final (path, title) in [
      ('/households', 'Households'),
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
    final container = await startApp(tester, signedIn: true);

    await tester.tap(find.text('Households'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Households'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(location(container), '/');

    await tester.tap(find.text('Uploads'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Uploads'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('Welcome to BoothConnect'), findsOneWidget);
  });

  testWidgets('signing out wipes the phone and goes back to sign-in', (
    tester,
  ) async {
    final container = await startApp(tester, signedIn: true);
    final store = container.read(localStoreProvider);
    final file = await tester.runAsync(() async {
      final db = await store.open();
      await db
          .into(db.syncMeta)
          .insert(SyncMetaCompanion.insert(key: 'cursor', value: 'c-1'));
      return store.file();
    });
    expect(file!.existsSync(), isTrue);

    await tester.tap(find.byTooltip('Sign out'));
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pumpAndSettle();
    expect(location(container), '/sign-in');
    expect(container.read(authProvider), AuthStatus.signedOut);
    expect(file.existsSync(), isFalse);
  });

  testWidgets('an unknown link says so and leads home', (tester) async {
    final container = await startApp(tester, signedIn: true);
    await go(tester, container, '/no-such-page');
    expect(find.text('Page not found'), findsOneWidget);
    await tester.tap(find.text('Go to home'));
    await tester.pumpAndSettle();
    expect(location(container), '/');
  });

  testWidgets('a release build has no way past sign-in yet', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: SignInScreen(allowDevContinue: false),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
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
      ]) {
        final uri = Uri(path: '/sign-in', queryParameters: {'from': from});
        expect(authRedirect(AuthStatus.signedIn, uri), '/', reason: from);
      }
    });
  });
}
