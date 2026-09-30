import 'package:boothconnect_mobile/theme/glass_surface.dart';
import 'package:boothconnect_mobile/theme/glass_system_settings.dart';
import 'package:boothconnect_mobile/theme/tokens.g.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

/// Stands in for the native side of [glassSettingsChannel]. `send` pushes a
/// value as if the phone setting changed.
class FakeGlassPlatform {
  FakeGlassPlatform(WidgetTester tester, {Map<String, bool>? initial}) {
    tester.binding.defaultBinaryMessenger.setMockStreamHandler(
      glassSettingsChannel,
      MockStreamHandler.inline(
        onListen: (arguments, events) {
          _events = events;
          if (initial != null) events.success(initial);
        },
      ),
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockStreamHandler(
        glassSettingsChannel,
        null,
      ),
    );
  }

  MockStreamHandlerEventSink? _events;

  void send({bool reduceTransparency = false, bool lowEndDevice = false}) =>
      _events!.success({
        'reduceTransparency': reduceTransparency,
        'lowEndDevice': lowEndDevice,
      });
}

Finder get blur => find.descendant(
  of: find.byType(GlassSurface),
  matching: find.byType(BackdropFilter),
);

Color glassFill(WidgetTester tester) {
  final box = tester.widget<DecoratedBox>(
    find.descendant(
      of: find.byType(GlassSurface),
      matching: find.byType(DecoratedBox),
    ),
  );
  final gradient =
      (box.decoration as BoxDecoration).gradient! as LinearGradient;
  return gradient.colors.last;
}

void main() {
  test('reads the platform map, treating anything unexpected as off', () {
    expect(
      GlassSystemSettings.fromPlatform({
        'reduceTransparency': true,
        'lowEndDevice': false,
      }),
      const GlassSystemSettings(reduceTransparency: true),
    );
    expect(
      GlassSystemSettings.fromPlatform({'lowEndDevice': true}),
      const GlassSystemSettings(lowEndDevice: true),
    );
    expect(GlassSystemSettings.fromPlatform(null), const GlassSystemSettings());
    expect(
      GlassSystemSettings.fromPlatform({'reduceTransparency': 'yes'}),
      const GlassSystemSettings(),
    );
  });

  testWidgets('app glass follows the phone reduce-transparency setting', (
    tester,
  ) async {
    final platform = FakeGlassPlatform(tester);
    await startApp(tester, glassPlatform: false);

    expect(blur, findsOneWidget);
    expect(glassFill(tester), BcThemeTokens.light.glassFill);

    platform.send(reduceTransparency: true);
    await tester.pumpAndSettle();
    expect(blur, findsNothing);
    expect(glassFill(tester), BcThemeTokens.light.opaqueFill);

    platform.send();
    await tester.pumpAndSettle();
    expect(blur, findsOneWidget);
  });

  testWidgets('a low-end or power-saving phone gets opaque glass', (
    tester,
  ) async {
    FakeGlassPlatform(tester, initial: {'lowEndDevice': true});
    await startApp(tester, glassPlatform: false);

    expect(blur, findsNothing);
    expect(glassFill(tester).a, 1);
  });
}
