import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../data/api/api_error.dart';
import '../../data/api/providers.dart';
import '../../data/api/voter_api.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';

/// What happened to the voter's record, newest first (#228). Online only.
final voterUpdatesProvider = FutureProvider.autoDispose<List<VoterUpdate>>(
  (ref) => ref.watch(voterApiProvider).updates(),
);

/// Updates (#228): changes to the voter's details (which and by whom, never
/// the values), visits to their home, and who can see their details.
class VoterUpdatesScreen extends ConsumerWidget {
  const VoterUpdatesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final updates = ref.watch(voterUpdatesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.voterTabUpdates)),
      body: switch (updates) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(voterUpdatesProvider.future),
          child: _Updates(items: value),
        ),
        AsyncError(:final error) => ErrorState(
          message: error is ApiError && error.isNetwork
              ? l10n.voterOffline
              : l10n.voterLoadFailed,
          onRetry: () => ref.invalidate(voterUpdatesProvider),
        ),
        _ => const LoadingState(),
      },
    );
  }
}

class _Updates extends StatelessWidget {
  const _Updates({required this.items});

  final List<VoterUpdate> items;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final date = DateFormat.yMMMd(
      Localizations.localeOf(context).toLanguageTag(),
    );
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(BcSpacing.md),
      children: [
        GlassSurface(
          padding: const EdgeInsets.all(BcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text(l10n.voterWhoSawTitle, style: text.titleMedium),
              ),
              const SizedBox(height: BcSpacing.xs),
              Text(l10n.voterWhoSawBody, style: text.bodyMedium),
            ],
          ),
        ),
        const SizedBox(height: BcSpacing.md),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.all(BcSpacing.md),
            child: Text(
              l10n.voterUpdatesEmpty,
              textAlign: TextAlign.center,
              style: text.bodyMedium,
            ),
          )
        else
          for (final item in items)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(switch (item.kind) {
                'visit' => Icons.home_outlined,
                'joined' => Icons.waving_hand_outlined,
                _ => Icons.edit_outlined,
              }),
              title: Text(updateText(l10n, item)),
              subtitle: Text(date.format(item.at.toLocal())),
            ),
      ],
    );
  }
}

/// One line of Updates, e.g. "Your booth volunteer updated your occupation".
@visibleForTesting
String updateText(AppLocalizations l10n, VoterUpdate update) {
  switch (update.kind) {
    case 'visit':
      final outcome = update.outcome;
      return l10n.voterUpdateVisit(
        outcome == null ? '' : visitOutcomeLabel(l10n, outcome) ?? outcome,
      );
    case 'joined':
      return l10n.voterUpdateJoined;
  }
  final key = update.fieldKey ?? '';
  // Lower case mid-sentence in English; Telugu has no case.
  final detail = (fieldLabel(l10n, key) ?? key).toLowerCase();
  return switch (update.by) {
    'you' => l10n.voterUpdateYou(detail),
    'admin' => l10n.voterUpdateAdmin(detail),
    _ => l10n.voterUpdateVolunteer(detail),
  };
}
