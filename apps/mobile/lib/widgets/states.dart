import 'package:flutter/material.dart';

import '../l10n/generated/app_localizations.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.g.dart';

/// Every screen shows one of these while it has no content to show: loading,
/// empty, error (with retry) and denied. [OfflineBanner] sits above content
/// instead, because the app keeps working offline.
///
/// They centre in the space they get and scroll rather than overflow at large
/// text sizes. Loading, error and denied are announced when they appear.

/// The screen's data is loading.
class LoadingState extends StatelessWidget {
  const LoadingState({super.key, this.message});

  /// Replaces "Loading…".
  final String? message;

  @override
  Widget build(BuildContext context) {
    final text = message ?? AppLocalizations.of(context).stateLoading;
    return _StateLayout(
      liveRegion: true,
      semanticsLabel: text,
      children: [
        const ExcludeSemantics(child: CircularProgressIndicator()),
        const SizedBox(height: BcSpacing.md),
        ExcludeSemantics(child: Text(text, textAlign: TextAlign.center)),
      ],
    );
  }
}

/// A list or screen with nothing in it (yet).
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    this.title,
    this.message,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  /// Replaces "Nothing here yet".
  final String? title;
  final String? message;
  final IconData icon;

  /// For example, a button that adds the first item.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return _StateLayout(
      children: [
        _StateIcon(icon, color: AppTokens.of(context).textMuted),
        _Title(title ?? AppLocalizations.of(context).stateEmptyTitle),
        if (message != null) _Message(message!),
        if (action != null) ...[const SizedBox(height: BcSpacing.lg), action!],
      ],
    );
  }
}

/// The screen couldn't load. [message] says why, for example the API's
/// `errorMessage(l10n, code)`.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, this.message, this.onRetry});

  final String? message;

  /// Shows "Try again" when given.
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _StateLayout(
      liveRegion: true,
      children: [
        _StateIcon(Icons.error_outline, color: AppTokens.of(context).danger),
        _Title(l10n.stateErrorTitle),
        if (message != null) _Message(message!),
        if (onRetry != null) ...[
          const SizedBox(height: BcSpacing.lg),
          FilledButton.icon(
            icon: const Icon(Icons.refresh),
            label: Text(l10n.stateRetry),
            onPressed: onRetry,
          ),
        ],
      ],
    );
  }
}

/// The volunteer isn't allowed to see this (the API said 403, or the record
/// is outside their booth).
class DeniedState extends StatelessWidget {
  const DeniedState({super.key, this.message});

  /// Replaces the default explanation.
  final String? message;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _StateLayout(
      liveRegion: true,
      children: [
        _StateIcon(Icons.lock_outline, color: AppTokens.of(context).textMuted),
        _Title(l10n.stateDeniedTitle),
        _Message(message ?? l10n.stateDeniedMessage),
      ],
    );
  }
}

/// A banner while the phone is offline. The content stays usable: changes
/// wait on the phone and upload later.
///
/// Put it first in the screen's scrolling content, not above it: at large
/// text sizes on a small phone it can be taller than the screen.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final tokens = AppTokens.of(context);
    final textTheme = Theme.of(context).textTheme;
    return Semantics(
      container: true,
      liveRegion: true,
      child: Material(
        color: tokens.warningContainer,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: BcSpacing.md,
            vertical: BcSpacing.sm,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.cloud_off_outlined, color: tokens.text),
              const SizedBox(width: BcSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.stateOfflineTitle,
                      style: textTheme.titleSmall?.copyWith(color: tokens.text),
                    ),
                    Text(
                      l10n.stateOfflineMessage,
                      style: textTheme.bodyMedium?.copyWith(color: tokens.text),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StateLayout extends StatelessWidget {
  const _StateLayout({
    required this.children,
    this.liveRegion = false,
    this.semanticsLabel,
  });

  final List<Widget> children;
  final bool liveRegion;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.all(BcSpacing.lg),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            minHeight: constraints.hasBoundedHeight
                ? (constraints.maxHeight - 2 * BcSpacing.lg).clamp(
                    0,
                    double.infinity,
                  )
                : 0,
          ),
          child: Center(
            child: Semantics(
              container: true,
              liveRegion: liveRegion,
              label: semanticsLabel,
              child: Column(mainAxisSize: MainAxisSize.min, children: children),
            ),
          ),
        ),
      ),
    );
  }
}

class _StateIcon extends StatelessWidget {
  const _StateIcon(this.icon, {required this.color});

  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: BcSpacing.md),
    child: Icon(icon, size: 48, color: color),
  );
}

class _Title extends StatelessWidget {
  const _Title(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    // Its own node, so only the title is a heading.
    container: true,
    header: true,
    child: Text(
      text,
      style: Theme.of(context).textTheme.titleLarge,
      textAlign: TextAlign.center,
    ),
  );
}

class _Message extends StatelessWidget {
  const _Message(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: BcSpacing.sm),
    child: Text(
      text,
      style: Theme.of(context).textTheme.bodyMedium
          ?.copyWith(color: AppTokens.of(context).textMuted),
      textAlign: TextAlign.center,
    ),
  );
}
