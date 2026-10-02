import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../data/api/api_error.dart';
import '../../data/api/providers.dart';
import '../../data/api/voter_api.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../auth/auth_controller.dart';

/// The signed-in voter's record, read from the API each time (#226). Nothing
/// is kept on the phone.
final voterSelfProvider = FutureProvider.autoDispose<VoterSelf>(
  (ref) => ref.watch(voterApiProvider).me(),
);

/// The voter's Home (#226): who they are and where they vote. Online only.
class VoterHomeScreen extends ConsumerWidget {
  const VoterHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final self = ref.watch(voterSelfProvider);

    Future<void> signOut() => ref.read(authProvider.notifier).signOut();

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appTitle),
        actions: [
          IconButton(
            onPressed: signOut,
            icon: const Icon(Icons.logout),
            tooltip: l10n.signOut,
          ),
        ],
      ),
      body: switch (self) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(voterSelfProvider.future),
          child: _Home(self: value),
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

class _Home extends StatelessWidget {
  const _Home({required this.self});

  final VoterSelf self;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final name = self.official.name;
    // Details the voter could share but hasn't yet.
    final missing = self.shared.where((d) => !d.isSet).toList();
    return ListView(
      // Pull to refresh works even when the content is short.
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(BcSpacing.md),
      children: [
        Semantics(
          header: true,
          child: Text(
            name == null ? l10n.voterGreetingNoName : l10n.voterGreeting(name),
            style: text.headlineSmall,
          ),
        ),
        const SizedBox(height: BcSpacing.md),
        if (missing.isNotEmpty) ...[
          Card(
            margin: EdgeInsets.zero,
            child: ListTile(
              leading: const Icon(Icons.edit_note),
              title: Text(l10n.voterCheckDetails),
              subtitle: Text(
                l10n.voterNotAddedYet(
                  missing
                      .map((d) => fieldLabel(l10n, d.key) ?? d.key)
                      .join(', '),
                ),
              ),
              trailing: TextButton(
                onPressed: () => context.push(Routes.voterDetailsEdit),
                child: Text(l10n.voterAdd),
              ),
            ),
          ),
          const SizedBox(height: BcSpacing.md),
        ],
        GlassSurface(
          padding: const EdgeInsets.all(BcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.voterBoothTitle, style: text.titleSmall),
              const SizedBox(height: BcSpacing.xs),
              Text(
                // Generated arguments are in alphabetical order: code, name.
                l10n.homeBoothLine(self.boothCode, self.boothName),
                style: text.titleLarge,
              ),
              const SizedBox(height: BcSpacing.xxs),
              // Generated arguments are in alphabetical order: code, name.
              Text(l10n.voterPartLine(self.partCode, self.partName)),
              if (self.serialNo != null) ...[
                const SizedBox(height: BcSpacing.xxs),
                Text(
                  l10n.voterSerialLine(self.serialNo!),
                  style: text.bodySmall,
                ),
              ],
              const SizedBox(height: BcSpacing.xs),
              Text(self.programName, style: text.bodySmall),
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
