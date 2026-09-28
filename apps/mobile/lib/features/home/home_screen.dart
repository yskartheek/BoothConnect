import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.appTitle)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(BcSpacing.lg),
          child: GlassSurface(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  l10n.homeWelcome,
                  style: textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: BcSpacing.sm),
                Text(l10n.homeComingSoon, textAlign: TextAlign.center),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
