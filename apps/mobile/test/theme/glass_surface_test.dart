import 'package:boothconnect_mobile/theme/app_theme.dart';
import 'package:boothconnect_mobile/theme/glass_surface.dart';
import 'package:boothconnect_mobile/theme/tokens.g.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> pumpGlass(
  WidgetTester tester, {
  ThemeData? theme,
  bool reduceTransparency = false,
  bool lowEndDevice = false,
  bool highContrast = false,
}) {
  return tester.pumpWidget(
    MaterialApp(
      theme: theme ?? AppTheme.light(),
      home: MediaQuery(
        data: MediaQueryData(highContrast: highContrast),
        child: GlassSettings(
          reduceTransparency: reduceTransparency,
          lowEndDevice: lowEndDevice,
          child: const Scaffold(body: GlassSurface(child: Text('Booth 142'))),
        ),
      ),
    ),
  );
}

BoxDecoration glassDecoration(WidgetTester tester) {
  final box = tester.widget<DecoratedBox>(
    find.descendant(
      of: find.byType(GlassSurface),
      matching: find.byType(DecoratedBox),
    ),
  );
  return box.decoration as BoxDecoration;
}

List<Color> fillColors(BoxDecoration decoration) =>
    (decoration.gradient! as LinearGradient).colors;

void main() {
  testWidgets('renders translucent, blurred glass by default', (tester) async {
    await pumpGlass(tester);

    expect(find.text('Booth 142'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(GlassSurface),
        matching: find.byType(BackdropFilter),
      ),
      findsOneWidget,
    );
    final decoration = glassDecoration(tester);
    expect(fillColors(decoration).last, BcThemeTokens.light.glassFill);
    expect(fillColors(decoration).last.a, lessThan(1));
  });

  testWidgets('renders opaque with no blur when reduced transparency is on', (
    tester,
  ) async {
    await pumpGlass(tester, reduceTransparency: true);

    expect(find.text('Booth 142'), findsOneWidget);
    expect(find.byType(BackdropFilter), findsNothing);
    final decoration = glassDecoration(tester);
    expect(fillColors(decoration), [
      BcThemeTokens.light.opaqueHighlight,
      BcThemeTokens.light.opaqueFill,
    ]);
    for (final color in fillColors(decoration)) {
      expect(color.a, 1, reason: 'every fill colour must be opaque');
    }
    expect(
      (decoration.border! as Border).top.color,
      BcThemeTokens.light.opaqueBorder,
    );
  });

  testWidgets('uses the dark opaque surface in the dark theme', (tester) async {
    await pumpGlass(tester, theme: AppTheme.dark(), reduceTransparency: true);

    expect(
      fillColors(glassDecoration(tester)).last,
      BcThemeTokens.dark.opaqueFill,
    );
  });

  testWidgets('renders opaque on low-end devices', (tester) async {
    await pumpGlass(tester, lowEndDevice: true);

    expect(find.byType(BackdropFilter), findsNothing);
    expect(fillColors(glassDecoration(tester)).last.a, 1);
  });

  testWidgets('renders opaque in high-contrast mode', (tester) async {
    await pumpGlass(tester, highContrast: true);

    expect(find.byType(BackdropFilter), findsNothing);
    expect(fillColors(glassDecoration(tester)).last.a, 1);
  });

  testWidgets('switches back to glass when the setting is turned off', (
    tester,
  ) async {
    await pumpGlass(tester, reduceTransparency: true);
    expect(find.byType(BackdropFilter), findsNothing);

    await pumpGlass(tester);
    expect(find.byType(BackdropFilter), findsOneWidget);
  });
}
