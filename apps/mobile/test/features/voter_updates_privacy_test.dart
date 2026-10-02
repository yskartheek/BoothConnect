import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/api/providers.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/fake_voter_api.dart';

// Updates and Privacy (#228). Synthetic data only.

void main() {
  Future<ProviderContainer> start(
    WidgetTester tester,
    FakeVoterApi voter, {
    FakeAuthApi? api,
  }) => startApp(
    tester,
    api: api ?? FakeAuthApi(voterSession: true),
    overrides: [voterApiProvider.overrideWithValue(voter)],
  );

  Future<void> tab(WidgetTester tester, String label) async {
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text(label),
      ),
    );
    await tester.pumpAndSettle();
  }

  int selectedTab(WidgetTester tester) =>
      tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex;

  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      100,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
  }

  group('Updates', () {
    testWidgets('lists what happened, newest first, and who can see', (
      tester,
    ) async {
      final container = await start(tester, FakeVoterApi());
      await tab(tester, 'Updates');
      expect(location(container), '/voter/updates');
      expect(selectedTab(tester), 2);

      expect(find.text('Who has seen my details?'), findsOneWidget);
      expect(
        find.text(
          'Your booth volunteer and the booth coordinator can see your '
          'details. Every view is logged.',
        ),
        findsOneWidget,
      );
      final lines = [
        'You updated your mobile number',
        'Booth volunteer visited · No one home',
        'Your booth volunteer updated your occupation',
        'An administrator updated your additional info',
        'You started using the app',
      ];
      for (final line in lines) {
        expect(find.text(line), findsOneWidget, reason: line);
      }
      // In the API's order.
      final ys = [for (final l in lines) tester.getTopLeft(find.text(l)).dy];
      expect(ys, [...ys]..sort());
      expect(find.text('Sep 30, 2026'), findsOneWidget);
      expect(find.text('Sep 1, 2026'), findsOneWidget);
    });

    testWidgets('nothing yet says so', (tester) async {
      await start(tester, FakeVoterApi(updates: []));
      await tab(tester, 'Updates');
      expect(
        find.text(
          'Nothing yet. Changes to your details and visits to your home will '
          'show here.',
        ),
        findsOneWidget,
      );
      expect(find.text('Who has seen my details?'), findsOneWidget);
    });

    testWidgets('offline: says to connect, and Try again reloads', (
      tester,
    ) async {
      final voter = FakeVoterApi();
      final container = await start(tester, voter);
      voter.failWith = const ApiError(ApiError.network);
      await go(tester, container, '/voter/updates');
      expect(
        find.text('Connect to the internet to see your details.'),
        findsOneWidget,
      );
      voter.failWith = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('You started using the app'), findsOneWidget);
    });

    testWidgets('another error says loading failed', (tester) async {
      final voter = FakeVoterApi();
      final container = await start(tester, voter);
      voter.failWith = const ApiError('NOT_FOUND', status: 404);
      await go(tester, container, '/voter/updates');
      expect(
        find.text("Couldn't load your details. Try again."),
        findsOneWidget,
      );
    });
  });

  group('Privacy', () {
    testWidgets('what the booth team sees and why, and consents', (
      tester,
    ) async {
      final container = await start(
        tester,
        FakeVoterApi(
          consents: [
            syntheticConsent(),
            syntheticConsent(id: 'c-0', status: 'withdrawn'),
          ],
        ),
      );
      await tab(tester, 'Privacy');
      expect(location(container), '/voter/privacy');
      expect(selectedTab(tester), 3);

      expect(find.text('Shared with your booth team'), findsOneWidget);
      expect(find.text('+919999900101'), findsOneWidget);
      expect(
        find.text(
          'So your booth volunteer can reach you, and so you can sign in.',
        ),
        findsOneWidget,
      );
      expect(find.text('Teacher'), findsOneWidget);
      expect(
        find.text('Helps your booth team understand the needs of your area.'),
        findsOneWidget,
      );
      expect(find.text('Not added'), findsOneWidget);
      expect(
        find.text('Anything you want your booth volunteer to know.'),
        findsOneWidget,
      );

      await scrollTo(tester, find.text('You stopped sharing on Sep 25, 2026'));
      expect(find.text('Shared with your consent'), findsOneWidget);
      expect(find.text('Caste / community'), findsNWidgets(2));
      expect(find.text('You agreed on Sep 20, 2026'), findsOneWidget);
      expect(
        find.text('Only with your consent. You can stop sharing at any time.'),
        findsOneWidget,
      );
      // Only the granted one can be stopped.
      expect(find.text('Stop sharing'), findsOneWidget);
    });

    testWidgets('Stop sharing asks first; keeping it sends nothing', (
      tester,
    ) async {
      final voter = FakeVoterApi();
      await start(tester, voter);
      await tab(tester, 'Privacy');
      await scrollTo(tester, find.text('Stop sharing'));
      await tester.tap(find.text('Stop sharing'));
      await tester.pumpAndSettle();
      expect(find.text('Stop sharing your caste / community?'), findsOneWidget);
      expect(
        find.text(
          'Your booth team will no longer see it, and it is removed from '
          'their phones.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Keep sharing'));
      await tester.pumpAndSettle();
      expect(voter.withdrawn, isEmpty);
      expect(find.text('You agreed on Sep 20, 2026'), findsOneWidget);
    });

    testWidgets('Stop sharing withdraws it and shows it stopped', (
      tester,
    ) async {
      final voter = FakeVoterApi();
      await start(tester, voter);
      await tab(tester, 'Privacy');
      await scrollTo(tester, find.text('Stop sharing'));
      await tester.tap(find.text('Stop sharing'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.widgetWithText(FilledButton, 'Stop sharing'),
        ),
      );
      await tester.pumpAndSettle();
      expect(voter.withdrawn, ['c-1']);
      expect(find.text('Stopped sharing.'), findsOneWidget);
      expect(find.text('You stopped sharing on Oct 2, 2026'), findsOneWidget);
      expect(find.text('Stop sharing'), findsNothing);
      // What's shared is read again.
      expect(voter.reads, greaterThan(1));
    });

    testWidgets('Stop sharing offline says so and keeps it', (tester) async {
      final voter = FakeVoterApi();
      await start(tester, voter);
      await tab(tester, 'Privacy');
      await scrollTo(tester, find.text('Stop sharing'));
      voter.failWith = const ApiError(ApiError.network);
      await tester.tap(find.text('Stop sharing'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Stop sharing'));
      await tester.pumpAndSettle();
      expect(
        find.text('Connect to the internet to see your details.'),
        findsOneWidget,
      );
      expect(find.text('You agreed on Sep 20, 2026'), findsOneWidget);

      // Another failure replaces the message at once.
      voter.failWith = const ApiError('FORBIDDEN', status: 403);
      await tester.tap(find.text('Stop sharing'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Stop sharing'));
      await tester.pumpAndSettle();
      expect(find.text("Couldn't save. Try again."), findsOneWidget);
      expect(voter.withdrawn, isEmpty);
    });

    testWidgets('no consents says so', (tester) async {
      await start(tester, FakeVoterApi(consents: []));
      await tab(tester, 'Privacy');
      await scrollTo(
        tester,
        find.text('You haven\'t agreed to share any other details.'),
      );
      expect(find.text('Stop sharing'), findsNothing);
    });

    testWidgets('offline: says to connect, and Try again reloads', (
      tester,
    ) async {
      final voter = FakeVoterApi();
      final container = await start(tester, voter);
      voter.failWith = const ApiError(ApiError.network);
      await go(tester, container, '/voter/privacy');
      expect(
        find.text('Connect to the internet to see your details.'),
        findsOneWidget,
      );
      voter.failWith = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Shared with your booth team'), findsOneWidget);
    });

    testWidgets('sign out from Privacy', (tester) async {
      final api = FakeAuthApi(voterSession: true);
      final container = await start(tester, FakeVoterApi(), api: api);
      await tab(tester, 'Privacy');
      final signOut = find.widgetWithText(OutlinedButton, 'Sign out');
      await scrollTo(tester, signOut);
      await tester.tap(signOut);
      await tester.pumpAndSettle();
      expect(api.logouts, 1);
      expect(container.read(authProvider), AuthStatus.signedOut);
    });
  });

  testWidgets('a volunteer can’t open Updates or Privacy', (tester) async {
    final container = await start(
      tester,
      FakeVoterApi(),
      api: FakeAuthApi(session: true),
    );
    for (final path in ['/voter/updates', '/voter/privacy']) {
      await go(tester, container, path);
      expect(location(container), '/', reason: path);
    }
  });

  testWidgets('small phone at 2× text: nothing overflows', (tester) async {
    await start(tester, FakeVoterApi());
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpAndSettle();
    for (final label in ['Updates', 'Privacy']) {
      await tab(tester, label);
      expect(tester.takeException(), isNull, reason: label);
    }
  });
}
