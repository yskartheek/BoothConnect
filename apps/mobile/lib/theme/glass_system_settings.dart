import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'glass_surface.dart';

/// The phone's own signals for glass surfaces, read by native code because
/// Flutter doesn't report them.
///
/// - iOS: Settings → Accessibility → Display & Text Size → Reduce
///   Transparency; Low Power Mode counts as a low-end device.
/// - Android has no reduce-transparency setting, so it reports whether the
///   system allows window blur (off in battery saver, or on devices that
///   can't blur). Low-RAM devices and battery saver count as low-end.
@immutable
class GlassSystemSettings {
  const GlassSystemSettings({
    this.reduceTransparency = false,
    this.lowEndDevice = false,
  });

  /// Reads the map sent by the native side. Anything unexpected means "off".
  factory GlassSystemSettings.fromPlatform(Object? value) {
    if (value is! Map) return const GlassSystemSettings();
    return GlassSystemSettings(
      reduceTransparency: value['reduceTransparency'] == true,
      lowEndDevice: value['lowEndDevice'] == true,
    );
  }

  final bool reduceTransparency;
  final bool lowEndDevice;

  @override
  bool operator ==(Object other) =>
      other is GlassSystemSettings &&
      other.reduceTransparency == reduceTransparency &&
      other.lowEndDevice == lowEndDevice;

  @override
  int get hashCode => Object.hash(reduceTransparency, lowEndDevice);
}

/// Implemented in MainActivity.kt / GlassSettingsStreamHandler.kt (Android)
/// and AppDelegate.swift (iOS). Sends the current values on listen and again
/// whenever they change.
const glassSettingsChannel = EventChannel('boothconnect/glass_settings');

/// Live [GlassSystemSettings]. Only Android and iOS implement the channel;
/// elsewhere it stays at the defaults.
final glassSystemSettingsProvider = StreamProvider<GlassSystemSettings>((ref) {
  final supported =
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);
  if (!supported) return Stream.value(const GlassSystemSettings());
  return glassSettingsChannel.receiveBroadcastStream().map(
    GlassSystemSettings.fromPlatform,
  );
});

/// Puts the phone's [GlassSystemSettings] into a [GlassSettings] for
/// everything below it. Until the first value arrives (or if the channel
/// fails) glass stays translucent.
class SystemGlassSettings extends ConsumerWidget {
  const SystemGlassSettings({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings =
        ref.watch(glassSystemSettingsProvider).value ??
        const GlassSystemSettings();
    return GlassSettings(
      reduceTransparency: settings.reduceTransparency,
      lowEndDevice: settings.lowEndDevice,
      child: child,
    );
  }
}
