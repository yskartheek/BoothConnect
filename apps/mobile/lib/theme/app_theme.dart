import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// The app's light and dark [ThemeData], built from the generated design
/// tokens (`tokens.g.dart`). Widgets that need tokens Material has no slot for
/// (glass, status colours) read them with [AppTokens.of].
abstract final class AppTheme {
  static ThemeData light() => _build(BcThemeTokens.light);

  static ThemeData dark() => _build(BcThemeTokens.dark);

  static ThemeData _build(BcThemeTokens t) {
    final colorScheme = ColorScheme(
      brightness: t.brightness,
      primary: t.primary,
      onPrimary: t.onPrimary,
      primaryContainer: t.primaryContainer,
      onPrimaryContainer: t.text,
      secondary: t.secondary,
      onSecondary: t.onSecondary,
      tertiary: t.accent,
      onTertiary: t.onPrimary,
      error: t.danger,
      onError: t.onDanger,
      errorContainer: t.dangerContainer,
      onErrorContainer: t.text,
      surface: t.surface,
      onSurface: t.text,
      onSurfaceVariant: t.textMuted,
      surfaceContainerLowest: t.surface,
      surfaceContainerLow: t.surface,
      surfaceContainer: t.surfaceMuted,
      surfaceContainerHigh: t.surfaceMuted,
      surfaceContainerHighest: t.surfaceMuted,
      outline: t.border,
      outlineVariant: t.divider,
      scrim: t.scrim,
    );
    final textTheme = const TextTheme(
      displaySmall: BcTextStyle.display,
      headlineSmall: BcTextStyle.headline,
      titleLarge: BcTextStyle.headline,
      titleMedium: BcTextStyle.title,
      bodyLarge: BcTextStyle.body,
      bodyMedium: BcTextStyle.bodySmall,
      bodySmall: BcTextStyle.caption,
      labelLarge: BcTextStyle.label,
      labelMedium: BcTextStyle.caption,
    ).apply(bodyColor: t.text, displayColor: t.text);
    const cardShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(BcRadius.medium)),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: t.brightness,
      colorScheme: colorScheme,
      textTheme: textTheme,
      fontFamily: BcFontFamily.ui,
      scaffoldBackgroundColor: t.background,
      dividerColor: t.divider,
      cardTheme: CardThemeData(color: t.surface, shape: cardShape),
      bottomSheetTheme: const BottomSheetThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(BcRadius.sheet),
          ),
        ),
      ),
      extensions: [AppTokens(t)],
    );
  }
}

/// Makes the full token set available through the theme.
class AppTokens extends ThemeExtension<AppTokens> {
  const AppTokens(this.tokens);

  final BcThemeTokens tokens;

  /// The tokens of the nearest theme, or the light tokens if the theme was not
  /// built by [AppTheme].
  static BcThemeTokens of(BuildContext context) =>
      Theme.of(context).extension<AppTokens>()?.tokens ?? BcThemeTokens.light;

  @override
  AppTokens copyWith({BcThemeTokens? tokens}) =>
      AppTokens(tokens ?? this.tokens);

  // Token sets are swapped, not blended: a theme change snaps at the midpoint.
  @override
  AppTokens lerp(AppTokens? other, double t) =>
      other == null || t < 0.5 ? this : other;
}
