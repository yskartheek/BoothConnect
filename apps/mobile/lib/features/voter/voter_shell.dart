import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../l10n/generated/app_localizations.dart';

/// The voter side's tabs: Home and My details (#227), Updates and Privacy
/// (#228).
class VoterShell extends StatelessWidget {
  const VoterShell({super.key, required this.child});

  final Widget child;

  static const _tabs = [
    Routes.voter,
    Routes.voterDetails,
    Routes.voterUpdates,
    Routes.voterPrivacy,
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final path = GoRouterState.of(context).uri.path;
    // Each tab is one page; the edit form is pushed outside the tabs.
    final index = _tabs.indexOf(path);
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index < 0 ? 0 : index,
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
          NavigationDestination(
            icon: const Icon(Icons.history_outlined),
            selectedIcon: const Icon(Icons.history),
            label: l10n.voterTabUpdates,
          ),
          NavigationDestination(
            icon: const Icon(Icons.shield_outlined),
            selectedIcon: const Icon(Icons.shield),
            label: l10n.voterTabPrivacy,
          ),
        ],
      ),
    );
  }
}
