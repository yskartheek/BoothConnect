import 'package:boothconnect_mobile/app/app.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:boothconnect_mobile/l10n/shared_labels.g.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final te = lookupAppLocalizations(const Locale('te'));

  test('English and Telugu are both supported', () {
    expect(
      AppLocalizations.supportedLocales.map((l) => l.languageCode),
      containsAll(['en', 'te']),
    );
  });

  test('shared keys from packages/i18n are available as getters', () {
    expect(en.syncStatePending, 'On phone');
    expect(en.syncStateConflict, 'Choose value');
    expect(en.consentCasteAgree, 'Voter agrees to share this');
    expect(te.syncStatePending, 'ఫోన్‌లో ఉంది');
  });

  test('API codes map to labels in each language', () {
    expect(visitOutcomeLabel(en, 'no_one_available'), 'No one home');
    expect(visitOutcomeLabel(te, 'no_one_available'), 'ఇంట్లో ఎవరూ లేరు');
    expect(syncStateLabel(en, 'failed'), 'Not uploaded');
    expect(
      errorMessage(en, 'UNAUTHENTICATED'),
      'Your session has ended. Sign in again.',
    );
    expect(visitOutcomeLabel(en, 'not_a_real_outcome'), isNull);
    expect(errorMessage(en, 'NOT_A_REAL_CODE'), isNull);
  });

  testWidgets('the app shows Telugu when the phone is set to Telugu', (
    tester,
  ) async {
    tester.platformDispatcher.localesTestValue = const [Locale('te')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);

    await tester.pumpWidget(const ProviderScope(child: BoothConnectApp()));
    await tester.pumpAndSettle();

    expect(find.text('BoothConnect కు స్వాగతం'), findsOneWidget);
  });
}
