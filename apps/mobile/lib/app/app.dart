import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../l10n/generated/app_localizations.dart';
import 'router.dart';

class BoothConnectApp extends ConsumerWidget {
  const BoothConnectApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Placeholder theme until the design tokens package (Epic 5) provides one.
    const seed = Color(0xFF1B5E9E);
    return MaterialApp.router(
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      theme: ThemeData(colorSchemeSeed: seed),
      darkTheme: ThemeData(colorSchemeSeed: seed, brightness: Brightness.dark),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
