import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../auth/auth_controller.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: l10n.signOut,
            onPressed: () => ref.read(authProvider.notifier).signOut(),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(BcSpacing.lg),
          child: GlassSurface(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  l10n.homeWelcome,
                  style: textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: BcSpacing.sm),
                Text(l10n.homeComingSoon, textAlign: TextAlign.center),
                const SizedBox(height: BcSpacing.lg),
                FilledButton.icon(
                  icon: const Icon(Icons.home_work_outlined),
                  label: Text(l10n.householdsTitle),
                  onPressed: () => context.push(Routes.households),
                ),
                const SizedBox(height: BcSpacing.sm),
                OutlinedButton.icon(
                  icon: const Icon(Icons.cloud_upload_outlined),
                  label: Text(l10n.syncTitle),
                  onPressed: () => context.push(Routes.sync),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
