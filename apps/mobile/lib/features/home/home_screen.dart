import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/router.dart';
import '../../data/local/app_database.dart';
import '../../data/local/local_reads.dart';
import '../../data/local/local_store.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../auth/auth_controller.dart';
import '../sync/sync_controller.dart';

/// Watches over the phone's database, which the home screen reads (never
/// the API).
StreamProvider<T> _local<T>(Stream<T> Function(AppDatabase db) watch) =>
    StreamProvider<T>((ref) {
      // Loading until the database is open; then the watch itself.
      final db = ref.watch(appDatabaseProvider).value;
      return db == null ? const Stream.empty() : watch(db);
    });

final boothsProvider = _local<List<BoothAssignment>>((db) => db.watchBooths());
final householdCountProvider = _local<int>((db) => db.watchHouseholdCount());
final visitedCountProvider = _local<int>((db) => db.watchVisitedCount());
final pendingCountProvider = _local<int>((db) => db.watchPendingCount());

/// Home: the volunteer's booth, visit progress, changes waiting to upload,
/// and the way to the households and the sync center. Pull down to
/// download the booth's latest data.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final online = ref.watch(onlineProvider).value ?? true;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: l10n.signOut,
            onPressed: () => ref.read(authProvider.notifier).signOut(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(syncControllerProvider.notifier).pullNow(),
        child: ListView(
          // Pull-to-refresh works however short the content.
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (!online) const OfflineBanner(),
            Padding(
              padding: const EdgeInsets.all(BcSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _BoothCard(),
                  const SizedBox(height: BcSpacing.md),
                  const _ProgressCard(),
                  const SizedBox(height: BcSpacing.md),
                  const _UploadsCard(),
                  const SizedBox(height: BcSpacing.lg),
                  FilledButton.icon(
                    icon: const Icon(Icons.home_work_outlined),
                    label: Text(l10n.householdsTitle),
                    onPressed: () => context.push(Routes.households),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => GlassSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Text(title, style: Theme.of(context).textTheme.titleMedium),
        ),
        const SizedBox(height: BcSpacing.xs),
        ...children,
      ],
    ),
  );
}

class _BoothCard extends ConsumerWidget {
  const _BoothCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final booths = ref.watch(boothsProvider).value ?? const [];
    return _Card(
      title: l10n.homeBoothTitle,
      children: [
        if (booths.isEmpty)
          Text(l10n.homeNoBooth)
        else
          for (final booth in booths)
            Text(
              // Generated arguments are in alphabetical order: code, name.
              l10n.homeBoothLine(booth.code, booth.name),
              style: Theme.of(context).textTheme.titleLarge,
            ),
      ],
    );
  }
}

class _ProgressCard extends ConsumerWidget {
  const _ProgressCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final total = ref.watch(householdCountProvider).value ?? 0;
    final visited = ref.watch(visitedCountProvider).value ?? 0;
    final number = NumberFormat.decimalPattern(_locale(context));
    // Generated arguments are in alphabetical order: total, visited.
    final text = l10n.homeVisited(number.format(total), number.format(visited));
    return _Card(
      title: l10n.homeProgressTitle,
      children: [
        Text(text),
        const SizedBox(height: BcSpacing.xs),
        // The text above says the same for screen readers.
        ExcludeSemantics(
          child: LinearProgressIndicator(
            value: total == 0 ? 0 : visited / total,
            minHeight: 8,
            borderRadius: BorderRadius.circular(BcRadius.pill),
          ),
        ),
      ],
    );
  }
}

class _UploadsCard extends ConsumerWidget {
  const _UploadsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final tokens = AppTokens.of(context);
    final pending = ref.watch(pendingCountProvider).value ?? 0;
    final sync = ref.watch(syncControllerProvider);
    final updated = switch (sync.phase) {
      SyncPhase.syncing => l10n.homeUpdating,
      SyncPhase.failed => l10n.homeUpdateFailed,
      _ when sync.lastPullAt != null => l10n.homeUpdated(
        DateFormat.MMMd(_locale(context))
            .add_jm()
            .format(sync.lastPullAt!.toLocal()),
      ),
      _ => l10n.homeNeverUpdated,
    };
    return _Card(
      title: l10n.homeUploadsTitle,
      children: [
        Row(
          children: [
            Badge(
              isLabelVisible: pending > 0,
              label: Text('$pending'),
              child: Icon(Icons.cloud_upload_outlined, color: tokens.text),
            ),
            const SizedBox(width: BcSpacing.sm),
            Expanded(
              child: Text(
                pending == 0 ? l10n.homeAllUploaded : l10n.homePending(pending),
              ),
            ),
          ],
        ),
        const SizedBox(height: BcSpacing.xs),
        Semantics(
          liveRegion: true,
          child: Text(
            updated,
            style: TextStyle(
              color: sync.phase == SyncPhase.failed
                  ? tokens.danger
                  : tokens.textMuted,
            ),
          ),
        ),
        const SizedBox(height: BcSpacing.sm),
        OutlinedButton.icon(
          icon: const Icon(Icons.sync),
          label: Text(l10n.syncTitle),
          onPressed: () => unawaited(context.push(Routes.sync)),
        ),
      ],
    );
  }
}

String _locale(BuildContext context) =>
    Localizations.localeOf(context).toLanguageTag();
