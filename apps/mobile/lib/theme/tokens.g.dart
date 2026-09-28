// GENERATED FILE. Do not edit by hand.
// Source: packages/design-tokens/tokens.json
// Regenerate: pnpm --filter @boothconnect/design-tokens build:dart
// ignore_for_file: public_member_api_docs

import 'dart:ui' show Brightness;

import 'package:flutter/animation.dart';
import 'package:flutter/painting.dart';
import 'package:flutter/physics.dart';

/// Corner radii in logical pixels.
abstract final class BcRadius {
  static const double small = 12;
  static const double medium = 18;
  static const double large = 24;
  static const double sheet = 28;
  static const double pill = 999;
}

/// Spacing steps in logical pixels.
abstract final class BcSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
}

/// Minimum tap target size per platform.
abstract final class BcTouchTarget {
  static const double ios = 44;
  static const double android = 48;
}

/// Primary font per role. The platform font is the fallback.
abstract final class BcFontFamily {
  static const String display = 'Bricolage Grotesque';
  static const String ui = 'Figtree';
  static const String mono = 'JetBrains Mono';
}

/// Font weights.
abstract final class BcFontWeight {
  static const FontWeight regular = FontWeight.w400;
  static const FontWeight medium = FontWeight.w500;
  static const FontWeight semibold = FontWeight.w600;
  static const FontWeight bold = FontWeight.w700;
}

/// Named text styles (no colour).
abstract final class BcTextStyle {
  static const TextStyle display = TextStyle(
    fontFamily: BcFontFamily.display,
    fontSize: 26,
    height: 32 / 26,
    fontWeight: BcFontWeight.bold,
  );
  static const TextStyle headline = TextStyle(
    fontFamily: BcFontFamily.display,
    fontSize: 20,
    height: 26 / 20,
    fontWeight: BcFontWeight.bold,
  );
  static const TextStyle title = TextStyle(
    fontFamily: BcFontFamily.ui,
    fontSize: 17,
    height: 24 / 17,
    fontWeight: BcFontWeight.semibold,
  );
  static const TextStyle body = TextStyle(
    fontFamily: BcFontFamily.ui,
    fontSize: 16,
    height: 24 / 16,
    fontWeight: BcFontWeight.regular,
  );
  static const TextStyle bodySmall = TextStyle(
    fontFamily: BcFontFamily.ui,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: BcFontWeight.regular,
  );
  static const TextStyle label = TextStyle(
    fontFamily: BcFontFamily.ui,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: BcFontWeight.semibold,
  );
  static const TextStyle caption = TextStyle(
    fontFamily: BcFontFamily.ui,
    fontSize: 12,
    height: 16 / 12,
    fontWeight: BcFontWeight.medium,
  );
}

/// Backdrop blur sigma for glass surfaces.
abstract final class BcBlur {
  static const double glass = 20;
  static const double sheet = 28;
}

/// Transition durations.
abstract final class BcDuration {
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration standard = Duration(milliseconds: 220);
  static const Duration slow = Duration(milliseconds: 300);
  static const Duration reducedMotion = Duration(milliseconds: 0);
}

/// Easing curves.
abstract final class BcEasing {
  static const Cubic standard = Cubic(0.2, 0, 0, 1);
  static const Cubic emphasized = Cubic(0.3, 0, 0, 1);
  static const Cubic exit = Cubic(0.3, 0, 1, 1);
}

/// Springs for sheets and card expansion.
abstract final class BcSpring {
  static const SpringDescription sheet = SpringDescription(
    mass: 1,
    stiffness: 380,
    damping: 34,
  );
  static const SpringDescription card = SpringDescription(
    mass: 1,
    stiffness: 500,
    damping: 38,
  );
}

/// Colours, glass and elevation for one theme. Use [light] or [dark].
final class BcThemeTokens {
  const BcThemeTokens({
    required this.brightness,
    required this.background,
    required this.backdropTintA,
    required this.backdropTintB,
    required this.surface,
    required this.surfaceMuted,
    required this.text,
    required this.textMuted,
    required this.primary,
    required this.onPrimary,
    required this.primaryContainer,
    required this.secondary,
    required this.onSecondary,
    required this.accent,
    required this.success,
    required this.successContainer,
    required this.warning,
    required this.warningContainer,
    required this.danger,
    required this.onDanger,
    required this.dangerContainer,
    required this.border,
    required this.divider,
    required this.focusRing,
    required this.scrim,
    required this.glassFill,
    required this.glassBorder,
    required this.glassHighlight,
    required this.opaqueFill,
    required this.opaqueBorder,
    required this.opaqueHighlight,
    required this.elevationLow,
    required this.elevationMedium,
    required this.elevationHigh,
  });

  final Brightness brightness;
  final Color background;
  final Color backdropTintA;
  final Color backdropTintB;
  final Color surface;
  final Color surfaceMuted;
  final Color text;
  final Color textMuted;
  final Color primary;
  final Color onPrimary;
  final Color primaryContainer;
  final Color secondary;
  final Color onSecondary;
  final Color accent;
  final Color success;
  final Color successContainer;
  final Color warning;
  final Color warningContainer;
  final Color danger;
  final Color onDanger;
  final Color dangerContainer;
  final Color border;
  final Color divider;
  final Color focusRing;
  final Color scrim;
  final Color glassFill;
  final Color glassBorder;
  final Color glassHighlight;
  final Color opaqueFill;
  final Color opaqueBorder;
  final Color opaqueHighlight;
  final List<BoxShadow> elevationLow;
  final List<BoxShadow> elevationMedium;
  final List<BoxShadow> elevationHigh;

  static const light = BcThemeTokens(
    brightness: Brightness.light,
    background: Color(0xFFF3F5FA),
    backdropTintA: Color(0xFFD6E0FF),
    backdropTintB: Color(0xFFCBEDEE),
    surface: Color(0xFFFFFFFF),
    surfaceMuted: Color(0xFFEEF1F7),
    text: Color(0xFF121A2B),
    textMuted: Color(0xFF56627A),
    primary: Color(0xFF2446B8),
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Color(0xFFE3E8F7),
    secondary: Color(0xFF0A7880),
    onSecondary: Color(0xFFFFFFFF),
    accent: Color(0xFF9C5E00),
    success: Color(0xFF1B7A47),
    successContainer: Color(0xFFE1F0E7),
    warning: Color(0xFF8F5B00),
    warningContainer: Color(0xFFF8EDDC),
    danger: Color(0xFFB02A2A),
    onDanger: Color(0xFFFFFFFF),
    dangerContainer: Color(0xFFF8E5E5),
    border: Color(0xFFD3DAE6),
    divider: Color(0x1C121A2B),
    focusRing: Color(0xFF2446B8),
    scrim: Color(0x730A1020),
    glassFill: Color(0x9EFFFFFF),
    glassBorder: Color(0x8CFFFFFF),
    glassHighlight: Color(0xB8FFFFFF),
    opaqueFill: Color(0xFFF8F9FC),
    opaqueBorder: Color(0xFFD3DAE6),
    opaqueHighlight: Color(0xFFFFFFFF),
    elevationLow: [
      BoxShadow(
        offset: Offset(0, 1),
        blurRadius: 2,
        spreadRadius: 0,
        color: Color(0x140A1020),
      ),
      BoxShadow(
        offset: Offset(0, 2),
        blurRadius: 8,
        spreadRadius: -2,
        color: Color(0x1A0A1020),
      ),
    ],
    elevationMedium: [
      BoxShadow(
        offset: Offset(0, 8),
        blurRadius: 18,
        spreadRadius: -8,
        color: Color(0x470A1020),
      ),
    ],
    elevationHigh: [
      BoxShadow(
        offset: Offset(0, 18),
        blurRadius: 40,
        spreadRadius: -12,
        color: Color(0x520A1020),
      ),
    ],
  );

  static const dark = BcThemeTokens(
    brightness: Brightness.dark,
    background: Color(0xFF0D1320),
    backdropTintA: Color(0xFF1B2A60),
    backdropTintB: Color(0xFF0D3C42),
    surface: Color(0xFF161D2B),
    surfaceMuted: Color(0xFF1D2638),
    text: Color(0xFFEAF0FA),
    textMuted: Color(0xFFA5B0C6),
    primary: Color(0xFF8AA2FF),
    onPrimary: Color(0xFF0A1024),
    primaryContainer: Color(0xFF232C4A),
    secondary: Color(0xFF55C6CD),
    onSecondary: Color(0xFF0A1024),
    accent: Color(0xFFF2AB45),
    success: Color(0xFF62CF90),
    successContainer: Color(0xFF1D3334),
    warning: Color(0xFFF2B75A),
    warningContainer: Color(0xFF35302A),
    danger: Color(0xFFFF8484),
    onDanger: Color(0xFF0A1024),
    dangerContainer: Color(0xFF3A2530),
    border: Color(0xFF2E3850),
    divider: Color(0x1AFFFFFF),
    focusRing: Color(0xFF8AA2FF),
    scrim: Color(0x8C000000),
    glassFill: Color(0xAD161B24),
    glassBorder: Color(0x24FFFFFF),
    glassHighlight: Color(0x1AFFFFFF),
    opaqueFill: Color(0xFF161D2B),
    opaqueBorder: Color(0xFF2E3850),
    opaqueHighlight: Color(0xFF1D2638),
    elevationLow: [
      BoxShadow(
        offset: Offset(0, 1),
        blurRadius: 2,
        spreadRadius: 0,
        color: Color(0x66000000),
      ),
      BoxShadow(
        offset: Offset(0, 2),
        blurRadius: 8,
        spreadRadius: -2,
        color: Color(0x73000000),
      ),
    ],
    elevationMedium: [
      BoxShadow(
        offset: Offset(0, 8),
        blurRadius: 18,
        spreadRadius: -8,
        color: Color(0x99000000),
      ),
    ],
    elevationHigh: [
      BoxShadow(
        offset: Offset(0, 18),
        blurRadius: 40,
        spreadRadius: -12,
        color: Color(0xB3000000),
      ),
    ],
  );
}
