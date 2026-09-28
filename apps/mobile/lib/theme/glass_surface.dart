import 'dart:ui' show ImageFilter;

import 'package:flutter/widgets.dart';

import 'app_theme.dart';
import 'tokens.g.dart';

/// Says whether glass surfaces below it must be opaque.
///
/// Flutter doesn't report the system "Reduce transparency" setting, so the
/// app passes it in (from its own setting or a platform check), together with
/// whether the device is too slow for backdrop blur. High-contrast mode also
/// turns glass opaque.
class GlassSettings extends InheritedWidget {
  const GlassSettings({
    super.key,
    this.reduceTransparency = false,
    this.lowEndDevice = false,
    required super.child,
  });

  final bool reduceTransparency;
  final bool lowEndDevice;

  /// True when glass under [context] should use the opaque fallback.
  static bool opaqueOf(BuildContext context) {
    final settings = context
        .dependOnInheritedWidgetOfExactType<GlassSettings>();
    return (settings?.reduceTransparency ?? false) ||
        (settings?.lowEndDevice ?? false) ||
        MediaQuery.maybeHighContrastOf(context) == true;
  }

  @override
  bool updateShouldNotify(GlassSettings oldWidget) =>
      reduceTransparency != oldWidget.reduceTransparency ||
      lowEndDevice != oldWidget.lowEndDevice;
}

/// A liquid-glass panel: translucent fill with backdrop blur, a thin luminous
/// border and a top highlight. Falls back to an opaque surface without blur
/// when [GlassSettings.opaqueOf] says so.
class GlassSurface extends StatelessWidget {
  const GlassSurface({
    super.key,
    required this.child,
    this.borderRadius = BcRadius.large,
    this.padding = const EdgeInsets.all(BcSpacing.lg),
    this.blurSigma = BcBlur.glass,
  });

  final Widget child;
  final double borderRadius;
  final EdgeInsetsGeometry padding;
  final double blurSigma;

  @override
  Widget build(BuildContext context) {
    final t = AppTokens.of(context);
    final opaque = GlassSettings.opaqueOf(context);
    final radius = BorderRadius.circular(borderRadius);
    final fill = opaque ? t.opaqueFill : t.glassFill;
    final highlight = opaque ? t.opaqueHighlight : t.glassHighlight;

    final panel = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        border: Border.all(color: opaque ? t.opaqueBorder : t.glassBorder),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: const [0, 0.35],
          colors: [highlight, fill],
        ),
        // Shadows under translucent glass would show through it.
        boxShadow: opaque ? t.elevationLow : null,
      ),
      child: Padding(padding: padding, child: child),
    );
    if (opaque) return panel;

    return ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blurSigma, sigmaY: blurSigma),
        child: panel,
      ),
    );
  }
}
