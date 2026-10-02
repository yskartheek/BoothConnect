import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/api/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/fake_voter_api.dart';

// My details and editing them (#227). Synthetic data only.

void main() {
  Future<ProviderContainer> start(WidgetTester tester, FakeVoterApi voter) =>
      startApp(
        tester,
        api: FakeAuthApi(voterSession: true),
        overrides: [voterApiProvider.overrideWithValue(voter)],
      );

  Future<void> openDetails(WidgetTester tester) async {
    await tester.tap(find.text('My details'));
    await tester.pumpAndSettle();
  }

  Future<void> openEdit(WidgetTester tester) async {
    await openDetails(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Edit'));
    await tester.pumpAndSettle();
  }

  Finder field(String label) => find.widgetWithText(TextFormField, label);

  Future<void> save(WidgetTester tester) async {
    await tester.tap(find.byTooltip('Save'));
    await tester.pumpAndSettle();
  }

  testWidgets('My details: the roll’s entry apart from what the voter shares', (
    tester,
  ) async {
    final container = await start(tester, FakeVoterApi());
    await openDetails(tester);
    expect(location(container), '/voter/details');

    expect(find.text('From the electoral roll'), findsOneWidget);
    expect(find.text('Official'), findsOneWidget);
    expect(find.text('Synthetic Lakshmi'), findsOneWidget);
    expect(find.text('46 · Female'), findsOneWidget);
    expect(find.text('SYN1000001'), findsOneWidget);
    expect(find.text('408 · 217'), findsOneWidget);
    expect(
      find.text(
        'Something wrong here? Official corrections are made with the '
        'Election Commission (Form 8).',
      ),
      findsOneWidget,
    );

    expect(find.text('Details you share'), findsOneWidget);
    expect(find.text('+919999900101'), findsOneWidget);
    expect(find.text('Teacher'), findsOneWidget);
    expect(find.text('Additional info'), findsOneWidget);
    expect(find.text('Not added'), findsOneWidget);
    expect(find.text('Shared with your booth team only.'), findsOneWidget);

    int selectedTab() =>
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex;
    expect(selectedTab(), 1);

    // Back to Home with the tab bar.
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    expect(location(container), '/voter');
    expect(selectedTab(), 0);
  });

  testWidgets('editing sends only what changed, then shows it', (tester) async {
    final voter = FakeVoterApi();
    final container = await start(tester, voter);
    await openEdit(tester);
    expect(find.text('Edit my details'), findsOneWidget);
    expect(find.text('Edit my details'), findsOneWidget);
    expect(
      find.text('Changing it changes the number you sign in with.'),
      findsOneWidget,
    );

    await tester.enterText(field('Occupation'), '  Farmer ');
    await tester.enterText(field('Additional info'), 'Synthetic note');
    await save(tester);

    expect(voter.saves, hasLength(1));
    expect(
      [for (final e in voter.saves.single) (e.key, e.value, e.baseVersion)],
      [
        ('occupation', 'Farmer', 'fv-occupation'),
        ('additional_info', 'Synthetic note', null),
      ],
    );
    expect(find.text('Saved.'), findsOneWidget);
    expect(location(container), '/voter/details');
    expect(find.text('Farmer'), findsOneWidget);
    expect(find.text('Synthetic note'), findsOneWidget);
    expect(find.text('Not added'), findsNothing);
  });

  testWidgets('a mobile number is checked, then sent as +91…', (tester) async {
    final voter = FakeVoterApi();
    await start(tester, voter);
    await openEdit(tester);

    await tester.enterText(field('Mobile number'), '12345');
    await save(tester);
    expect(
      find.text('Enter a 10-digit mobile number, or + and the country code.'),
      findsOneWidget,
    );
    expect(voter.saves, isEmpty);

    await tester.enterText(field('Mobile number'), '98765 43210');
    await save(tester);
    expect(
      [for (final e in voter.saves.single) (e.key, e.value)],
      [('mobile_number', '+919876543210')],
    );
  });

  testWidgets('nothing changed: closes without saving', (tester) async {
    final voter = FakeVoterApi();
    final container = await start(tester, voter);
    await openEdit(tester);
    // The same number typed differently is not a change; an emptied detail
    // is left as it was.
    await tester.enterText(field('Mobile number'), '99999 00101');
    await tester.enterText(field('Occupation'), '');
    await save(tester);
    expect(voter.saves, isEmpty);
    expect(location(container), '/voter/details');
    expect(find.text('Teacher'), findsOneWidget);
  });

  testWidgets('someone else changed it: says which, and shows theirs', (
    tester,
  ) async {
    final voter = FakeVoterApi()
      ..statusOf = (e) => e.key == 'occupation' ? 'conflict' : 'applied';
    await start(tester, voter);
    await openEdit(tester);
    await tester.enterText(field('Occupation'), 'Farmer');
    await save(tester);
    expect(
      find.text(
        'Someone else changed your occupation just now. Check it and try again.',
      ),
      findsOneWidget,
    );
    expect(voter.reads, greaterThan(1));
    expect(find.text('Teacher'), findsOneWidget);
  });

  testWidgets('a rejected detail says saving failed', (tester) async {
    final voter = FakeVoterApi()..statusOf = (_) => 'rejected';
    await start(tester, voter);
    await openEdit(tester);
    await tester.enterText(field('Occupation'), 'Farmer');
    await save(tester);
    expect(find.text("Couldn't save. Try again."), findsOneWidget);
    expect(find.text('Saved.'), findsNothing);
  });

  testWidgets('offline: stays on the form with what was typed', (tester) async {
    final voter = FakeVoterApi();
    await start(tester, voter);
    await openEdit(tester);
    voter.failWith = const ApiError(ApiError.network);
    await tester.enterText(field('Occupation'), 'Farmer');
    await save(tester);
    expect(
      find.text('Connect to the internet to see your details.'),
      findsOneWidget,
    );
    expect(find.text('Edit my details'), findsOneWidget);
    expect(find.text('Farmer'), findsOneWidget);

    voter.failWith = null;
    await save(tester);
    expect(voter.saves, hasLength(1));
    expect(find.text('Saved.'), findsOneWidget);
  });

  testWidgets('a second failed save replaces the first message at once', (
    tester,
  ) async {
    final voter = FakeVoterApi();
    await start(tester, voter);
    await openEdit(tester);
    await tester.enterText(field('Occupation'), 'Farmer');
    voter.failWith = const ApiError(ApiError.network);
    await save(tester);
    expect(
      find.text('Connect to the internet to see your details.'),
      findsOneWidget,
    );
    voter.failWith = const ApiError('FORBIDDEN', status: 403);
    await save(tester);
    expect(find.text("Couldn't save. Try again."), findsOneWidget);
  });

  testWidgets('another error while saving says saving failed', (tester) async {
    final voter = FakeVoterApi();
    await start(tester, voter);
    await openEdit(tester);
    voter.failWith = const ApiError('FORBIDDEN', status: 403);
    await tester.enterText(field('Occupation'), 'Farmer');
    await save(tester);
    expect(find.text("Couldn't save. Try again."), findsOneWidget);
    expect(find.text('Edit my details'), findsOneWidget);
  });

  testWidgets('Home asks for missing details, and Add opens the form', (
    tester,
  ) async {
    await start(tester, FakeVoterApi());
    expect(find.text('Check your details'), findsOneWidget);
    expect(find.text('Additional info not added yet'), findsOneWidget);
    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    expect(find.text('Edit my details'), findsOneWidget);
  });

  testWidgets('Home doesn’t ask when everything is shared', (tester) async {
    await start(
      tester,
      FakeVoterApi(
        self: syntheticVoter(
          shared: const {
            'mobile_number': '+919999900101',
            'occupation': 'Teacher',
            'additional_info': 'Synthetic note',
          },
        ),
      ),
    );
    expect(find.text('Namaste, Synthetic Lakshmi'), findsOneWidget);
    expect(find.text('Check your details'), findsNothing);
  });

  testWidgets('My details offline: says to connect', (tester) async {
    final voter = FakeVoterApi(failWith: const ApiError(ApiError.network));
    final container = await start(tester, voter);
    await go(tester, container, '/voter/details');
    expect(
      find.text('Connect to the internet to see your details.'),
      findsOneWidget,
    );
    voter.failWith = null;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('From the electoral roll'), findsOneWidget);
  });

  testWidgets('a volunteer can’t open the voter’s pages', (tester) async {
    final container = await startApp(
      tester,
      api: FakeAuthApi(session: true),
      overrides: [voterApiProvider.overrideWithValue(FakeVoterApi())],
    );
    for (final path in ['/voter/details', '/voter/details/edit']) {
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
    expect(tester.takeException(), isNull);
    await openDetails(tester);
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(
      find.widgetWithText(TextButton, 'Edit'),
      100,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.widgetWithText(TextButton, 'Edit'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Edit'));
    await tester.pumpAndSettle();
    expect(find.text('Edit my details'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
