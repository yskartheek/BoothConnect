import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../data/api/api_error.dart';
import '../../data/api/voter_api.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import 'voter_home_screen.dart' show voterSelfProvider;

/// My details (#227): the roll's entry, which the app can't change, kept
/// apart from the details the voter shares, which they can.
class VoterDetailsScreen extends ConsumerWidget {
  const VoterDetailsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final self = ref.watch(voterSelfProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.voterTabDetails)),
      body: switch (self) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(voterSelfProvider.future),
          child: _Details(self: value),
        ),
        AsyncError(:final error) => ErrorState(
          message: error is ApiError && error.isNetwork
              ? l10n.voterOffline
              : l10n.voterLoadFailed,
          onRetry: () => ref.invalidate(voterSelfProvider),
        ),
        _ => const LoadingState(),
      },
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.self});

  final VoterSelf self;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final official = self.official;
    final gender = official.gender == null
        ? null
        : genderLabel(l10n, official.gender!) ?? official.gender;
    final ageGender = [?official.age?.toString(), ?gender].join(' · ');

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(BcSpacing.md),
      children: [
        GlassSurface(
          padding: const EdgeInsets.all(BcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: BcSpacing.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Semantics(
                    header: true,
                    child: Text(
                      l10n.voterOfficialTitle,
                      style: text.titleMedium,
                    ),
                  ),
                  Chip(
                    label: Text(l10n.voterOfficialChip),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
              const SizedBox(height: BcSpacing.xs),
              _Row(l10n.fieldName, official.name),
              if (ageGender.isNotEmpty) _Row(l10n.voterAgeGender, ageGender),
              _Row(l10n.voterEpicLabel, self.epicNumber),
              _Row(
                l10n.voterPartSerial,
                [self.partCode, ?self.serialNo?.toString()].join(' · '),
              ),
              // Generated arguments are in alphabetical order: code, name.
              _Row(
                l10n.voterBoothTitle,
                l10n.homeBoothLine(self.boothCode, self.boothName),
              ),
              const SizedBox(height: BcSpacing.sm),
              Text(l10n.voterForm8, style: text.bodySmall),
            ],
          ),
        ),
        const SizedBox(height: BcSpacing.md),
        GlassSurface(
          padding: const EdgeInsets.all(BcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text(
                        l10n.voterSharedTitle,
                        style: text.titleMedium,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => context.push(Routes.voterDetailsEdit),
                    icon: const Icon(Icons.edit_outlined),
                    label: Text(l10n.householdEdit),
                  ),
                ],
              ),
              for (final detail in self.shared)
                _Row(
                  fieldLabel(l10n, detail.key) ?? detail.key,
                  detail.isSet ? '${detail.value}' : null,
                  missing: l10n.voterNotAdded,
                ),
              const SizedBox(height: BcSpacing.sm),
              Text(l10n.voterSharedNote, style: text.bodySmall),
            ],
          ),
        ),
        const SizedBox(height: BcSpacing.lg),
        Text(
          l10n.voterNotOfficial,
          textAlign: TextAlign.center,
          style: text.bodySmall,
        ),
      ],
    );
  }
}

/// A label and its value, one under the other (long values and large text
/// wrap rather than overflow).
class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.missing});

  final String label;
  final String? value;

  /// Shown, muted, when there is no value; otherwise the row is left out.
  final String? missing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    if (value == null && missing == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: BcSpacing.xxs),
      child: MergeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: text.labelMedium),
            Text(
              value ?? missing!,
              style: value == null
                  ? text.bodyMedium?.copyWith(fontStyle: FontStyle.italic)
                  : text.bodyLarge,
            ),
          ],
        ),
      ),
    );
  }
}
