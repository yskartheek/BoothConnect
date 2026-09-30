import 'dart:async';
import 'dart:io';

import 'package:boothconnect_mobile/app/app.dart';
import 'package:boothconnect_mobile/app/router.dart';
import 'package:boothconnect_mobile/data/api/providers.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/auth/sign_in_screen.dart';
import 'package:boothconnect_mobile/features/sync/sync_controller.dart';
import 'package:boothconnect_mobile/theme/glass_system_settings.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_auth_api.dart';
import 'fake_sync_api.dart';
import 'memory_secrets.dart';

/// Starts the whole app with a fake API and a database in a temporary
/// folder. [api] decides whether a session is stored (signed in).
///
/// The phone's glass settings channel answers with nothing, unless
/// [glassPlatform] is false because the test set up its own.
Future<ProviderContainer> startApp(
  WidgetTester tester, {
  FakeAuthApi? api,
  FakeSyncApi? syncApi,
  Stream<List<ConnectivityResult>>? connectivity,
  bool glassPlatform = true,
}) async {
  if (glassPlatform) {
    final messenger = tester.binding.defaultBinaryMessenger;
    messenger.setMockStreamHandler(
      glassSettingsChannel,
      MockStreamHandler.inline(onListen: (arguments, events) {}),
    );
    addTearDown(
      () => messenger.setMockStreamHandler(glassSettingsChannel, null),
    );
  }
  final dir = Directory.systemTemp.createTempSync('bc_app_test');
  final secrets = MemorySecrets();
  final container = ProviderContainer(
    overrides: [
      secretStoreProvider.overrideWithValue(secrets),
      authApiProvider.overrideWithValue(api ?? FakeAuthApi()),
      syncApiProvider.overrideWithValue(syncApi ?? FakeSyncApi()),
      connectivityChangesProvider.overrideWithValue(
        connectivity ?? const Stream.empty(),
      ),
      localStoreProvider.overrideWithValue(
        LocalStore(
          directory: () async => dir,
          keys: DatabaseKeyStore(secrets),
          inBackground: false,
        ),
      ),
    ],
  );
  addTearDown(() async {
    await container.read(localStoreProvider).wipe();
    container.dispose();
    dir.deleteSync(recursive: true);
  });
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const BoothConnectApp(),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

String location(ProviderContainer container) => container
    .read(routerProvider)
    .routerDelegate
    .currentConfiguration
    .uri
    .toString();

Future<void> go(
  WidgetTester tester,
  ProviderContainer container,
  String path,
) async {
  container.read(routerProvider).go(path);
  await tester.pumpAndSettle();
}

/// Signs in through the screen: phone, Send code, code, Sign in.
Future<void> signInThroughScreen(
  WidgetTester tester, {
  String phone = '98765 43210',
  String code = goodCode,
}) async {
  await tester.enterText(find.byType(TextField), phone);
  await tester.tap(find.text('Send code'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField), code);
  await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
  // Signing in touches the database (whose data it holds): wait for the
  // button's spinner, which shows from the next frame, to go.
  await tester.pump();
  final busy = find.descendant(
    of: find.byType(SignInScreen),
    matching: find.byType(CircularProgressIndicator),
  );
  await waitFor(tester, () => busy.evaluate().isEmpty);
}

/// Lets real async work (file and database I/O) run until [done] holds.
/// Each result comes back on the real clock and its continuation runs on
/// the next pump, so real time and pumps alternate.
Future<void> waitFor(WidgetTester tester, bool Function() done) async {
  for (var i = 0; i < 500 && !done(); i++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    // Moves the test's clock too: some steps wait on timers.
    await tester.pump(const Duration(milliseconds: 10));
  }
  await tester.pumpAndSettle();
}

/// Waits for [future] while letting real async work (file and database
/// I/O) run. Awaiting such a future inside `runAsync` alone can deadlock:
/// work started on the test's fake clock completes only as it pumps.
Future<T> settle<T>(WidgetTester tester, Future<T> future) async {
  late T value;
  Object? error;
  StackTrace? trace;
  var done = false;
  unawaited(
    future.then(
      (v) {
        value = v;
        done = true;
      },
      onError: (Object e, StackTrace s) {
        error = e;
        trace = s;
        done = true;
      },
    ),
  );
  await waitFor(tester, () => done);
  if (!done) throw StateError('Timed out waiting for a future');
  if (error != null) Error.throwWithStackTrace(error!, trace!);
  return value;
}
