import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/api/providers.dart';
import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/fake_voter_api.dart';

// Synthetic data only.

void main() {
  Future<ProviderContainer> start(
    WidgetTester tester, {
    FakeAuthApi? api,
    FakeVoterApi? voter,
  }) => startApp(
    tester,
    api: api ?? FakeAuthApi(),
    overrides: [voterApiProvider.overrideWithValue(voter ?? FakeVoterApi())],
  );

  Future<void> chooseVoter(WidgetTester tester) async {
    await tester.tap(find.text('Voter'));
    await tester.pumpAndSettle();
  }

  testWidgets('a voter signs in with their voter ID and lands on Home', (
    tester,
  ) async {
    final api = FakeAuthApi();
    final container = await start(tester, api: api);
    expect(find.text('Booth volunteer'), findsOneWidget);
    await chooseVoter(tester);
    expect(
      find.text('This app is not run by the Election Commission.'),
      findsOneWidget,
    );

    await tester.enterText(
      find.widgetWithText(TextField, 'Voter ID (EPIC) number'),
      ' syn 1000001 ',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Mobile number'),
      '99999 00101',
    );
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(api.voterRequested, [('SYN1000001', '+919999900101')]);
    expect(api.requested, isEmpty);
    // Never says whether the details matched.
    expect(
      find.text(
        'If these details match your record, we sent a code to +919999900101.',
      ),
      findsOneWidget,
    );

    await tester.enterText(find.byType(TextField), goodCode);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(api.voterVerified, [('SYN1000001', '+919999900101', goodCode)]);
    expect(container.read(authProvider), AuthStatus.voter);
    expect(location(container), '/voter');

    expect(find.text('Namaste, Synthetic Lakshmi'), findsOneWidget);
    expect(find.text('Demo Primary School, booth 142'), findsOneWidget);
    expect(find.text('Part 408 · Demo Nagar'), findsOneWidget);
    expect(find.text('Serial 217 on the roll'), findsOneWidget);
    expect(
      find.text('This app is not run by the Election Commission.'),
      findsOneWidget,
    );
  });

  testWidgets('a voter ID that can’t be one is caught before sending', (
    tester,
  ) async {
    final api = FakeAuthApi();
    await start(tester, api: api);
    await chooseVoter(tester);
    await tester.enterText(
      find.widgetWithText(TextField, 'Voter ID (EPIC) number'),
      'A1',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Mobile number'),
      '98765 43210',
    );
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(
      find.text('Enter your voter ID number as printed on your card.'),
      findsOneWidget,
    );
    expect(api.voterRequested, isEmpty);
  });

  testWidgets(
    'a wrong code says so, without saying whether the details matched',
    (tester) async {
      final container = await start(tester);
      await chooseVoter(tester);
      await tester.enterText(
        find.widgetWithText(TextField, 'Voter ID (EPIC) number'),
        'SYN1000001',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Mobile number'),
        '9999900101',
      );
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '000000');
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();
      expect(find.text('That code is wrong or has expired.'), findsOneWidget);
      expect(container.read(authProvider), AuthStatus.signedOut);
    },
  );

  testWidgets('a voter’s stored session opens the voter side', (tester) async {
    final container = await start(tester, api: FakeAuthApi(voterSession: true));
    expect(container.read(authProvider), AuthStatus.voter);
    expect(location(container), '/voter');
    expect(find.text('Namaste, Synthetic Lakshmi'), findsOneWidget);
  });

  testWidgets('each side’s pages are closed to the other', (tester) async {
    final voter = await start(tester, api: FakeAuthApi(voterSession: true));
    for (final path in [
      '/',
      '/households',
      '/household/h-1',
      '/sync',
      '/member/v-1',
    ]) {
      await go(tester, voter, path);
      expect(location(voter), '/voter', reason: path);
    }
    await stopApp(voter);

    final volunteer = await start(tester, api: FakeAuthApi(session: true));
    await go(tester, volunteer, '/voter');
    expect(location(volunteer), '/');
  });

  testWidgets('offline: says to connect, and Try again reloads', (
    tester,
  ) async {
    final voter = FakeVoterApi(failWith: const ApiError(ApiError.network));
    await start(tester, api: FakeAuthApi(voterSession: true), voter: voter);
    expect(
      find.text('Connect to the internet to see your details.'),
      findsOneWidget,
    );

    voter.failWith = null;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Namaste, Synthetic Lakshmi'), findsOneWidget);
  });

  testWidgets('another error: says loading failed', (tester) async {
    await start(
      tester,
      api: FakeAuthApi(voterSession: true),
      voter: FakeVoterApi(failWith: const ApiError('NOT_FOUND', status: 404)),
    );
    expect(find.text("Couldn't load your details. Try again."), findsOneWidget);
  });

  testWidgets('sign out ends the voter’s session', (tester) async {
    final api = FakeAuthApi(voterSession: true);
    final container = await start(tester, api: api);
    await tester.tap(find.byTooltip('Sign out'));
    await tester.pumpAndSettle();
    expect(api.logouts, 1);
    expect(container.read(authProvider), AuthStatus.signedOut);
    expect(Uri.parse(location(container)).path, '/sign-in');
  });

  testWidgets('a voter’s sign-out leaves the phone’s database alone', (
    tester,
  ) async {
    // A volunteer's data left on a shared phone (their session ended
    // without signing out) may hold changes not uploaded yet.
    final container = await start(tester, api: FakeAuthApi(voterSession: true));
    final db = await settle(tester, container.read(appDatabaseProvider.future));
    await settle(
      tester,
      db
          .into(db.syncMeta)
          .insert(SyncMetaCompanion.insert(key: 'owner', value: 'volunteer-1')),
    );
    await tester.tap(find.byTooltip('Sign out'));
    await tester.pumpAndSettle();
    final rows = await settle(tester, db.select(db.syncMeta).get());
    expect(rows.map((r) => r.value), contains('volunteer-1'));
  });

  testWidgets('a session that isn’t a voter’s is refused on the voter side', (
    tester,
  ) async {
    // The API answers as a volunteer (no voter link): the session is ended.
    final api = _NotAVoter();
    final container = await start(tester, api: api);
    await chooseVoter(tester);
    await tester.enterText(
      find.widgetWithText(TextField, 'Voter ID (EPIC) number'),
      'SYN1000001',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Mobile number'),
      '9999900101',
    );
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), goodCode);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(api.logouts, 1);
    expect(container.read(authProvider), AuthStatus.signedOut);
  });

  testWidgets('voter sign-in on a small phone at 2× text: nothing overflows', (
    tester,
  ) async {
    await start(tester);
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpAndSettle();
    await chooseVoter(tester);
    expect(tester.takeException(), isNull);
  });
}

class _NotAVoter extends FakeAuthApi {
  @override
  Future<void> verifyVoterOtp(String epic, String phone, String code) async {
    voterVerified.add((epic, phone, code));
    session = true; // the API gave a session, but /me has no voter
  }
}
