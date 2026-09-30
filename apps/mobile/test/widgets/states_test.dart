import 'dart:math';

import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:boothconnect_mobile/theme/app_theme.dart';
import 'package:boothconnect_mobile/widgets/states.dart';
import 'package:boothconnect_mobile/widgets/sync_status_chip.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Shows [child] in a screen of the given theme and text size.
Future<void> show(
  WidgetTester tester,
  Widget child, {
  Brightness brightness = Brightness.light,
  double textScale = 1,
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: brightness == Brightness.light
          ? AppTheme.light()
          : AppTheme.dark(),
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: MediaQuery.withClampedTextScaling(
        minScaleFactor: textScale,
        maxScaleFactor: textScale,
        child: Scaffold(body: child),
      ),
    ),
  );
  // The spinner never settles: pump a frame instead.
  await tester.pump();
}

/// A small phone: 320×480 logical pixels.
void smallPhone(WidgetTester tester) {
  tester.view.physicalSize = const Size(320, 480);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// WCAG contrast ratio of two opaque colours.
double contrast(Color a, Color b) {
  final la = a.computeLuminance(), lb = b.computeLuminance();
  return (max(la, lb) + 0.05) / (min(la, lb) + 0.05);
}

/// Contrast, tap target size and labels, as the platform guidelines ask.
Future<void> expectAccessible(WidgetTester tester) async {
  final handle = tester.ensureSemantics();
  await expectLater(tester, meetsGuideline(textContrastGuideline));
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  handle.dispose();
}

final states = <String, Widget Function(VoidCallback retry)>{
  'loading': (_) => const LoadingState(),
  'empty': (_) => EmptyState(
    message: 'No households are assigned to your booth yet.',
    action: OutlinedButton(onPressed: () {}, child: const Text('Refresh')),
  ),
  'error': (retry) =>
      ErrorState(message: 'The server is busy.', onRetry: retry),
  'denied': (_) => const DeniedState(),
  // As screens use it: the first item of the scrolling content.
  'offline': (_) => ListView(
    children: const [
      OfflineBanner(),
      ListTile(title: Text('Content')),
    ],
  ),
};

void main() {
  for (final brightness in Brightness.values) {
    group('${brightness.name} theme', () {
      for (final MapEntry(key: name, value: build) in states.entries) {
        testWidgets('$name: accessible, and fits at 2× text', (tester) async {
          await show(tester, build(() {}), brightness: brightness);
          await expectAccessible(tester);

          smallPhone(tester);
          await show(
            tester,
            build(() {}),
            brightness: brightness,
            textScale: 2,
          );
          expect(tester.takeException(), isNull);
        });
      }

      for (final status in SyncStatus.values) {
        testWidgets('sync chip "${status.name}": accessible, fits at 2× text', (
          tester,
        ) async {
          await show(
            tester,
            Center(
              child: SyncStatusChip(status: status, onTap: () {}),
            ),
            brightness: brightness,
          );
          await expectAccessible(tester);
          expect(
            tester.getSize(find.byType(SyncStatusChip)).height,
            greaterThanOrEqualTo(48),
          );
          // The chip's text is outside the semantics tree, so the contrast
          // guideline can't see it: check the colours directly.
          final text = tester.widget<Text>(
            find.descendant(
              of: find.byType(SyncStatusChip),
              matching: find.byType(Text),
            ),
          );
          final fill =
              (tester
                          .widget<DecoratedBox>(
                            find
                                .descendant(
                                  of: find.byType(SyncStatusChip),
                                  matching: find.byType(DecoratedBox),
                                )
                                .first,
                          )
                          .decoration
                      as BoxDecoration)
                  .color!;
          expect(contrast(text.style!.color!, fill), greaterThanOrEqualTo(4.5));
          smallPhone(tester);
          await show(
            tester,
            Center(child: SyncStatusChip(status: status)),
            brightness: brightness,
            textScale: 2,
          );
          expect(tester.takeException(), isNull);
        });
      }
    });
  }

  testWidgets('loading says so, and is announced', (tester) async {
    final handle = tester.ensureSemantics();
    await show(tester, const LoadingState());
    expect(find.text('Loading…'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Loading…')),
      isSemantics(label: 'Loading…', isLiveRegion: true),
    );
    handle.dispose();
  });

  testWidgets('empty: a default heading, or the one given', (tester) async {
    await show(tester, const EmptyState());
    expect(find.text('Nothing here yet'), findsOneWidget);
    await show(tester, const EmptyState(title: 'No households'));
    expect(find.text('No households'), findsOneWidget);
    expect(find.text('Nothing here yet'), findsNothing);
  });

  testWidgets('error: the reason, a heading, and Try again', (tester) async {
    final handle = tester.ensureSemantics();
    var retried = 0;
    await show(
      tester,
      ErrorState(message: 'The server is busy.', onRetry: () => retried++),
    );
    expect(find.text('Something went wrong'), findsOneWidget);
    expect(find.text('The server is busy.'), findsOneWidget);
    expect(
      tester.getSemantics(find.text('Something went wrong')),
      isSemantics(label: 'Something went wrong', isHeader: true),
    );
    // Announced when it appears.
    expect(
      tester.getSemantics(find.bySemanticsLabel('The server is busy.')),
      isSemantics(isLiveRegion: true),
    );
    await tester.tap(find.text('Try again'));
    expect(retried, 1);

    // No retry: no button.
    await show(tester, const ErrorState());
    expect(find.text('Try again'), findsNothing);
    handle.dispose();
  });

  testWidgets('denied and offline explain themselves', (tester) async {
    await show(tester, const DeniedState());
    expect(find.text('No access'), findsOneWidget);
    expect(
      find.text(
        "You don't have access to this. Ask your coordinator if you think you should.",
      ),
      findsOneWidget,
    );
    await show(tester, const OfflineBanner());
    expect(find.text("You're offline"), findsOneWidget);
    expect(
      find.text(
        "Your changes stay on this phone and upload when you're back online.",
      ),
      findsOneWidget,
    );
  });

  testWidgets('the sync chip: a word and an icon per status', (tester) async {
    final handle = tester.ensureSemantics();
    for (final (status, word, icon) in [
      (SyncStatus.pending, 'On phone', Icons.phone_android),
      (SyncStatus.syncing, 'Uploading', Icons.sync),
      (SyncStatus.synced, 'Uploaded', Icons.cloud_done_outlined),
      (SyncStatus.conflict, 'Choose value', Icons.call_split),
      (SyncStatus.failed, 'Not uploaded', Icons.error_outline),
    ]) {
      await show(tester, Center(child: SyncStatusChip(status: status)));
      expect(find.text(word), findsOneWidget);
      expect(find.byIcon(icon), findsOneWidget);
      expect(
        tester.getSemantics(find.byType(SyncStatusChip)),
        matchesSemantics(label: 'Upload status: $word'),
      );
    }
    handle.dispose();
  });

  testWidgets('a tappable chip is a 48dp button', (tester) async {
    final handle = tester.ensureSemantics();
    var taps = 0;
    await show(
      tester,
      Center(
        child: SyncStatusChip(status: SyncStatus.conflict, onTap: () => taps++),
      ),
    );
    expect(
      tester.getSize(find.byType(SyncStatusChip)).height,
      greaterThanOrEqualTo(48),
    );
    expect(
      tester.getSemantics(find.byType(SyncStatusChip)),
      matchesSemantics(
        label: 'Upload status: Choose value',
        isButton: true,
        hasTapAction: true,
        hasFocusAction: true,
        isFocusable: true,
      ),
    );
    await tester.tap(find.byType(SyncStatusChip));
    expect(taps, 1);
    handle.dispose();
  });

  test('sync statuses from API codes', () {
    expect(SyncStatus.fromCode('conflict'), SyncStatus.conflict);
    expect(SyncStatus.fromCode('unknown'), isNull);
  });

  testWidgets('the states are in Telugu too', (tester) async {
    await show(tester, const DeniedState(), locale: const Locale('te'));
    expect(find.text('యాక్సెస్ లేదు'), findsOneWidget);
    await show(
      tester,
      const Center(child: SyncStatusChip(status: SyncStatus.synced)),
      locale: const Locale('te'),
    );
    expect(find.bySemanticsLabel(RegExp('^అప్‌లోడ్ స్థితి: ')), findsOneWidget);
  });
}
