import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../l10n/generated/app_localizations.dart';

/// The voter side's tabs (#227): Home and My details.
class VoterShell extends StatelessWidget {
  const VoterShell({super.key, required this.child});

  final Widget child;

  static const _tabs = [Routes.voter, Routes.voterDetails];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final path = GoRouterState.of(context).uri.path;
    final index = path.startsWith(Routes.voterDetails) ? 1 : 0;
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => context.go(_tabs[i]),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.home_outlined),
            selectedIcon: const Icon(Icons.home),
            label: l10n.voterTabHome,
          ),
          NavigationDestination(
            icon: const Icon(Icons.badge_outlined),
            selectedIcon: const Icon(Icons.badge),
            label: l10n.voterTabDetails,
          ),
        ],
      ),
    );
  }
}
