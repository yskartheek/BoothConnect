import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../l10n/generated/app_localizations.dart';
import '../theme/tokens.g.dart';
import 'router.dart';

/// Shown for a path the app doesn't know (a stale link, for example).
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.notFoundTitle)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(BcSpacing.lg),
          child: FilledButton(
            onPressed: () => context.go(Routes.home),
            child: Text(l10n.goHome),
          ),
        ),
      ),
    );
  }
}
