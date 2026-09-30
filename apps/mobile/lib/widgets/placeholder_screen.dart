import 'package:flutter/material.dart';

import '../l10n/generated/app_localizations.dart';
import '../theme/glass_surface.dart';
import '../theme/tokens.g.dart';

/// A screen that isn't built yet: its title and "This screen is being built."
class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen({super.key, required this.title, this.actions});

  final String title;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: actions),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(BcSpacing.lg),
          child: GlassSurface(
            child: Text(l10n.screenComingSoon, textAlign: TextAlign.center),
          ),
        ),
      ),
    );
  }
}
