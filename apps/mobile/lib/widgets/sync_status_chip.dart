import 'package:flutter/material.dart';

import '../l10n/generated/app_localizations.dart';
import '../l10n/shared_labels.g.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.g.dart';

/// Where a change stands on its way to the server (the API's sync states).
enum SyncStatus {
  pending,
  syncing,
  synced,
  conflict,
  failed;

  /// The status for an API code, or null if it is unknown.
  static SyncStatus? fromCode(String code) {
    for (final s in values) {
      if (s.name == code) return s;
    }
    return null;
  }
}

/// A small chip with the sync status: an icon and a word, never colour alone.
///
/// With [onTap] (for example, "Choose value" on a conflict) it is a button at
/// least 48dp tall.
class SyncStatusChip extends StatelessWidget {
  const SyncStatusChip({super.key, required this.status, this.onTap});

  final SyncStatus status;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final tokens = AppTokens.of(context);
    final label = syncStateLabel(l10n, status.name)!;
    final (icon, fill) = switch (status) {
      SyncStatus.pending => (Icons.phone_android, tokens.surfaceMuted),
      SyncStatus.syncing => (Icons.sync, tokens.primaryContainer),
      SyncStatus.synced => (Icons.cloud_done_outlined, tokens.successContainer),
      SyncStatus.conflict => (Icons.call_split, tokens.warningContainer),
      SyncStatus.failed => (Icons.error_outline, tokens.dangerContainer),
    };
    final chip = DecoratedBox(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(BcRadius.pill),
        border: Border.all(color: tokens.border),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: BcSpacing.sm,
          vertical: BcSpacing.xxs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: tokens.text),
            const SizedBox(width: BcSpacing.xxs),
            Flexible(
              child: Text(
                label,
                style: Theme.of(context).textTheme.labelMedium
                    ?.copyWith(color: tokens.text),
              ),
            ),
          ],
        ),
      ),
    );

    // One node: "Upload status: …", plus the tap action when tappable.
    final labelled = Semantics(
      label: l10n.syncStatusLabel(label),
      button: onTap != null,
      child: ExcludeSemantics(child: chip),
    );
    if (onTap == null) return labelled;
    return MergeSemantics(
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: BcTouchTarget.android,
          minWidth: BcTouchTarget.android,
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BcRadius.pill),
          child: Center(widthFactor: 1, heightFactor: 1, child: labelled),
        ),
      ),
    );
  }
}
