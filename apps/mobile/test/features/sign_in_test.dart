import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/api/auth_api.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/auth/phone.dart';
import 'package:boothconnect_mobile/features/auth/sign_in_screen.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';

void main() {
  testWidgets('a volunteer signs in with the code and reaches home', (
    tester,
  ) async {
    final api = FakeAuthApi();
    final container = await startApp(tester, api: api);
    expect(find.text('Sign in'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '98765 43210');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    // The number went out in international format.
    expect(api.requested, ['+919876543210']);
    expect(
      find.text('We sent a 6-digit code to +919876543210.'),
      findsOneWidget,
    );

    await tester.enterText(find.byType(TextField), goodCode);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(api.verified, [('+919876543210', goodCode)]);
    expect(container.read(authProvider), AuthStatus.signedIn);
    expect(location(container), '/');
    expect(find.text('Your booth'), findsOneWidget);
  });

  testWidgets('a wrong code says so, and the right one still works', (
    tester,
  ) async {
    final container = await startApp(tester);
    await signInThroughScreen(tester, code: '000000');

    expect(find.text('That code is wrong or has expired.'), findsOneWidget);
    expect(container.read(authProvider), AuthStatus.signedOut);
    expect(location(container), '/sign-in');

    await tester.enterText(find.byType(TextField), goodCode);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(location(container), '/');
  });

  testWidgets('someone with no volunteer assignment is denied', (tester) async {
    final api = FakeAuthApi(
      assignments: const [
        Assignment(
          role: 'admin',
          nodeType: 'ac',
          nodeName: 'Demo Assembly Constituency',
          nodeCode: '101',
        ),
      ],
    );
    final container = await startApp(tester, api: api);
    await signInThroughScreen(tester);

    expect(find.text('No access'), findsOneWidget);
    expect(
      find.text(
        'This app is for volunteers assigned to a booth. Ask your '
        'coordinator to assign you, then sign in again.',
      ),
      findsOneWidget,
    );
    // Not signed in, and the session was ended again.
    expect(container.read(authProvider), AuthStatus.signedOut);
    expect(api.logouts, 1);
    expect(api.session, isFalse);

    await tester.tap(find.text('Use another number'));
    await tester.pumpAndSettle();
    expect(find.text('Send code'), findsOneWidget);
  });

  testWidgets('a number that can’t be used is caught before sending', (
    tester,
  ) async {
    final api = FakeAuthApi();
    await startApp(tester, api: api);
    await tester.enterText(find.byType(TextField), '12345');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(
      find.text('Enter a 10-digit mobile number, or one starting with +.'),
      findsOneWidget,
    );
    expect(api.requested, isEmpty);
  });

  testWidgets('a code that isn’t 6 digits is caught before sending', (
    tester,
  ) async {
    final api = FakeAuthApi();
    await startApp(tester, api: api);
    await signInThroughScreen(tester, code: '123');
    expect(find.text('Enter the 6-digit code.'), findsOneWidget);
    expect(api.verified, isEmpty);
  });

  testWidgets('offline, it says the server can’t be reached', (tester) async {
    await startApp(
      tester,
      api: FakeAuthApi(failWith: const ApiError(ApiError.network)),
    );
    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(
      find.text("Can't reach the server. Check your connection and try again."),
      findsOneWidget,
    );
    // Still on the phone step.
    expect(find.text('Send code'), findsOneWidget);
  });

  testWidgets('too many requests: the API’s reason is shown', (tester) async {
    await startApp(
      tester,
      api: FakeAuthApi(failWith: const ApiError('RATE_LIMITED', status: 429)),
    );
    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(
      find.text('Too many attempts. Wait a moment and try again.'),
      findsOneWidget,
    );
  });

  testWidgets('"Change number" goes back to the phone step', (tester) async {
    await startApp(tester);
    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Change number'));
    await tester.pumpAndSettle();
    expect(find.text('Send code'), findsOneWidget);
  });

  testWidgets('the development hint shows in debug builds only', (
    tester,
  ) async {
    await startApp(tester);
    // Tests run as a debug build.
    expect(
      find.text("Development build: the code is written to the API's log."),
      findsOneWidget,
    );

    // A release build: no hint.
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: SignInScreen(showDevHint: false),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Send code'), findsOneWidget);
    expect(find.textContaining('Development build'), findsNothing);
  });

  group('normalizePhone', () {
    test('Indian mobile numbers as people type them', () {
      for (final input in [
        '9876543210',
        '98765 43210',
        '98765-43210',
        '09876543210',
        '919876543210',
        '+91 98765 43210',
        '(+91) 98765-43210',
      ]) {
        expect(normalizePhone(input), '+919876543210', reason: input);
      }
    });

    test('other countries with +', () {
      expect(normalizePhone('+1 415 555 0100'), '+14155550100');
    });

    test('numbers that can’t be used', () {
      for (final input in [
        '',
        '12345',
        '5876543210', // Indian mobiles start 6–9
        '98765432101',
        '+0123456789',
        'abc',
      ]) {
        expect(normalizePhone(input), isNull, reason: input);
      }
    });
  });
}
