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
import '../auth/auth_controller.dart';
import 'voter_home_screen.dart' show voterSelfProvider;
import 'voter_updates_screen.dart' show voterUpdatesProvider;

/// The voter's consents (#228). Online only.
final voterConsentsProvider = FutureProvider.autoDispose<List<VoterConsent>>(
  (ref) => ref.watch(voterApiProvider).consents(),
);

/// Why the booth team has a detail, in the voter's words; null for a detail
/// the app doesn't know.
String? _purpose(AppLocalizations l10n, String key) => switch (key) {
  'mobile_number' => l10n.voterPurposeMobile,
  'occupation' => l10n.voterPurposeOccupation,
  'additional_info' => l10n.voterPurposeAdditionalInfo,
  _ => null,
};

/// Privacy (#228): what the booth team sees and why, the details shared only
/// with consent (each can be stopped), and sign out.
class VoterPrivacyScreen extends ConsumerWidget {
  const VoterPrivacyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final self = ref.watch(voterSelfProvider);
    final consents = ref.watch(voterConsentsProvider);
    final error = self.error ?? consents.error;

    Future<void> refresh() async {
      ref
        ..invalidate(voterSelfProvider)
        ..invalidate(voterConsentsProvider);
      await Future.wait([
        ref.read(voterSelfProvider.future),
        ref.read(voterConsentsProvider.future),
      ]);
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.voterTabPrivacy)),
      body: switch ((self, consents)) {
        _ when error != null => ErrorState(
          message: error is ApiError && error.isNetwork
              ? l10n.voterOffline
              : l10n.voterLoadFailed,
          onRetry: () => ref
            ..invalidate(voterSelfProvider)
            ..invalidate(voterConsentsProvider),
        ),
        (AsyncData(value: final s), AsyncData(value: final c)) =>
          RefreshIndicator(
            onRefresh: refresh,
            child: _Privacy(self: s, consents: c),
          ),
        _ => const LoadingState(),
      },
    );
  }
}

class _Privacy extends ConsumerStatefulWidget {
  const _Privacy({required this.self, required this.consents});

  final VoterSelf self;
  final List<VoterConsent> consents;

  @override
  ConsumerState<_Privacy> createState() => _PrivacyState();
}

class _PrivacyState extends ConsumerState<_Privacy> {
  /// The consent being withdrawn, if any.
  String? _stopping;

  Future<void> _stopSharing(VoterConsent consent, String detail) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.voterStopSharingTitle(detail.toLowerCase())),
        content: Text(l10n.voterStopSharingBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.voterKeepSharing),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l10n.voterStopSharing),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _stopping = consent.id);
    String message;
    try {
      await ref.read(voterApiProvider).withdrawConsent(consent.id);
      message = l10n.voterStoppedSharing;
      // What's shared, and the history, may have changed.
      ref
        ..invalidate(voterConsentsProvider)
        ..invalidate(voterSelfProvider)
        ..invalidate(voterUpdatesProvider);
    } on ApiError catch (e) {
      message = e.isNetwork ? l10n.voterOffline : l10n.voterSaveFailed;
    }
    if (mounted) setState(() => _stopping = null);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final date = DateFormat.yMMMd(
      Localizations.localeOf(context).toLanguageTag(),
    );

    Widget heading(String label) =>
        Semantics(header: true, child: Text(label, style: text.titleMedium));

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(BcSpacing.md),
      children: [
        GlassSurface(
          padding: const EdgeInsets.all(BcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              heading(l10n.voterPrivacySharedTitle),
              for (final detail in widget.self.shared)
                _Item(
                  label: fieldLabel(l10n, detail.key) ?? detail.key,
                  value: detail.isSet ? '${detail.value}' : l10n.voterNotAdded,
                  note: _purpose(l10n, detail.key),
                ),
              const SizedBox(height: BcSpacing.sm),
              Text(l10n.voterSharedNote, style: text.bodySmall),
            ],
          ),
        ),
        const SizedBox(height: BcSpacing.md),
        GlassSurface(
          padding: const EdgeInsets.all(BcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              heading(l10n.voterConsentTitle),
              if (widget.consents.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: BcSpacing.xs),
                  child: Text(l10n.voterNoConsents, style: text.bodyMedium),
                ),
              for (final consent in widget.consents)
                () {
                  final detail =
                      fieldLabel(l10n, consent.purpose) ?? consent.purpose;
                  return _Item(
                    label: detail,
                    value: consent.isGranted
                        ? l10n.voterConsentGiven(
                            date.format(consent.capturedAt.toLocal()),
                          )
                        : l10n.voterConsentWithdrawn(
                            date.format(
                              (consent.withdrawnAt ?? consent.capturedAt)
                                  .toLocal(),
                            ),
                          ),
                    note: consent.isGranted ? l10n.voterPurposeConsent : null,
                    action: consent.isGranted
                        ? OutlinedButton(
                            onPressed: _stopping == null
                                ? () => _stopSharing(consent, detail)
                                : null,
                            child: Text(l10n.voterStopSharing),
                          )
                        : null,
                  );
                }(),
            ],
          ),
        ),
        const SizedBox(height: BcSpacing.lg),
        OutlinedButton.icon(
          onPressed: () => ref.read(authProvider.notifier).signOut(),
          icon: const Icon(Icons.logout),
          label: Text(l10n.signOut),
        ),
        const SizedBox(height: BcSpacing.md),
        Text(
          l10n.voterNotOfficial,
          textAlign: TextAlign.center,
          style: text.bodySmall,
        ),
      ],
    );
  }
}

/// A detail: its name, its value or state, why it's shared, and an action.
/// One under the other, so long text and large fonts wrap.
class _Item extends StatelessWidget {
  const _Item({
    required this.label,
    required this.value,
    this.note,
    this.action,
  });

  final String label;
  final String value;
  final String? note;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: BcSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: text.labelMedium),
                Text(value, style: text.bodyLarge),
                if (note != null) Text(note!, style: text.bodySmall),
              ],
            ),
          ),
          if (action != null) ...[
            const SizedBox(height: BcSpacing.xs),
            action!,
          ],
        ],
      ),
    );
  }
}
