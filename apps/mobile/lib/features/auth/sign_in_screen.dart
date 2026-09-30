import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import 'auth_controller.dart';

/// Placeholder sign-in. OTP sign-in replaces it in #60. Until then, a
/// development build can continue without signing in; a release build can't.
class SignInScreen extends ConsumerWidget {
  const SignInScreen({super.key, this.allowDevContinue = kDebugMode});

  final bool allowDevContinue;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
                  l10n.signInTitle,
                  style: textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: BcSpacing.sm),
                Text(l10n.signInComingSoon, textAlign: TextAlign.center),
                if (allowDevContinue) ...[
                  const SizedBox(height: BcSpacing.lg),
                  FilledButton(
                    onPressed: () => ref.read(authProvider.notifier).signedIn(),
                    child: Text(l10n.signInDevContinue),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
