import 'package:boothconnect_mobile/theme/app_theme.dart';
import 'package:boothconnect_mobile/theme/tokens.g.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('light and dark themes use the generated colours', () {
    for (final (theme, tokens) in [
      (AppTheme.light(), BcThemeTokens.light),
      (AppTheme.dark(), BcThemeTokens.dark),
    ]) {
      expect(theme.brightness, tokens.brightness);
      expect(theme.colorScheme.primary, tokens.primary);
      expect(theme.colorScheme.onPrimary, tokens.onPrimary);
      expect(theme.colorScheme.surface, tokens.surface);
      expect(theme.colorScheme.onSurface, tokens.text);
      expect(theme.colorScheme.error, tokens.danger);
      expect(theme.scaffoldBackgroundColor, tokens.background);
      expect(theme.extension<AppTokens>()!.tokens, same(tokens));
    }
  });

  test('text styles come from the tokens', () {
    final text = AppTheme.light().textTheme;
    expect(text.bodyLarge!.fontSize, 16);
    expect(text.bodyLarge!.height, 24 / 16);
    expect(text.bodyLarge!.color, BcThemeTokens.light.text);
    expect(text.headlineSmall!.fontFamily, BcFontFamily.display);
    expect(AppTheme.dark().textTheme.bodyLarge!.color, BcThemeTokens.dark.text);
  });

  test('generated constants match tokens.json', () {
    expect(BcRadius.large, 24);
    expect(BcSpacing.md, 16);
    expect(BcDuration.standard, const Duration(milliseconds: 220));
    expect(BcDuration.reducedMotion, Duration.zero);
    expect(BcThemeTokens.light.glassFill, const Color(0x9EFFFFFF));
    expect(BcThemeTokens.light.opaqueFill, const Color(0xFFF8F9FC));
    expect(BcThemeTokens.dark.elevationMedium.single.blurRadius, 18);
  });

  testWidgets('AppTokens.of falls back to the light tokens', (tester) async {
    late BcThemeTokens found;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            found = AppTokens.of(context);
            return const SizedBox();
          },
        ),
      ),
    );
    expect(found, same(BcThemeTokens.light));
  });
}
