import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../data/local/local_reads.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../../widgets/sync_status_chip.dart';
import '../shared/local_watch.dart';
import '../sync/sync_controller.dart';

final householdSummariesProvider = localWatch<List<HouseholdSummary>>(
  (db) => db.watchHouseholdSummaries(),
);

/// Which households the list shows.
enum HouseholdFilter { all, notVisited, visited, followUp }

/// The booth's households from the phone's database: search by address or
/// member name, filter by visit status, each with its upload status.
class HouseholdsScreen extends ConsumerStatefulWidget {
  const HouseholdsScreen({super.key});

  @override
  ConsumerState<HouseholdsScreen> createState() => _HouseholdsScreenState();
}

class _HouseholdsScreenState extends ConsumerState<HouseholdsScreen> {
  final _search = TextEditingController();
  var _query = '';
  var _filter = HouseholdFilter.all;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _clear() => setState(() {
    _search.clear();
    _query = '';
    _filter = HouseholdFilter.all;
  });

  void _add() => context.push(Routes.newHousehold);

  Future<void> _refresh() =>
      ref.read(syncControllerProvider.notifier).pullNow();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // The header button on iOS, an extended floating button on Android.
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final summaries = ref.watch(householdSummariesProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.householdsTitle),
        actions: [
          if (ios)
            TextButton(onPressed: _add, child: Text(l10n.householdsAddShort)),
        ],
      ),
      floatingActionButton: ios
          ? null
          : FloatingActionButton.extended(
              onPressed: _add,
              icon: const Icon(Icons.add_home_outlined),
              label: Text(l10n.householdsAdd),
            ),
      body: switch (summaries) {
        AsyncData(:final value) => _list(context, value),
        AsyncError() => ErrorState(onRetry: _refresh),
        _ => const LoadingState(),
      },
    );
  }

  Widget _list(BuildContext context, List<HouseholdSummary> all) {
    final l10n = AppLocalizations.of(context);
    final sorted = [...all]
      ..sort((a, b) {
        final byKey = compareHouseKeys(a.houseKey, b.houseKey);
        return byKey != 0 ? byKey : a.address.compareTo(b.address);
      });
    int count(HouseholdFilter f) => sorted.where((h) => _inFilter(h, f)).length;
    final shown = sorted
        .where((h) => _inFilter(h, _filter) && h.matches(_query))
        .toList();

    final Widget content;
    if (all.isEmpty) {
      content = _scrollable(
        EmptyState(
          icon: Icons.home_work_outlined,
          title: l10n.householdsEmptyTitle,
          message: l10n.householdsEmptyMessage,
        ),
      );
    } else if (shown.isEmpty) {
      content = _scrollable(
        EmptyState(
          icon: Icons.search_off,
          title: l10n.householdsNoResultsTitle,
          message: l10n.householdsNoResultsMessage,
          action: OutlinedButton(
            onPressed: _clear,
            child: Text(l10n.householdsClearSearch),
          ),
        ),
      );
    } else {
      content = ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        // Room for the floating button below the last row.
        padding: const EdgeInsets.only(bottom: BcSpacing.xxl * 2),
        itemCount: shown.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, i) => _HouseholdRow(household: shown[i]),
      );
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            BcSpacing.md,
            BcSpacing.sm,
            BcSpacing.md,
            BcSpacing.xs,
          ),
          child: TextField(
            controller: _search,
            onChanged: (value) => setState(() => _query = value),
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: l10n.householdsSearchHint,
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      tooltip: l10n.householdsClearSearch,
                      onPressed: _clear,
                    ),
            ),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: BcSpacing.md),
          child: Row(
            children: [
              for (final f in HouseholdFilter.values)
                Padding(
                  padding: const EdgeInsets.only(right: BcSpacing.xs),
                  child: _FilterChip(
                    label: _filterLabel(l10n, f),
                    count: count(f),
                    selected: _filter == f,
                    onSelected: () => setState(() => _filter = f),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: BcSpacing.xs),
        Expanded(
          child: RefreshIndicator(onRefresh: _refresh, child: content),
        ),
      ],
    );
  }

  /// The empty states scroll too, so pull-to-refresh works on them.
  Widget _scrollable(Widget child) => LayoutBuilder(
    builder: (context, constraints) => ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [SizedBox(height: constraints.maxHeight, child: child)],
    ),
  );

  static bool _inFilter(HouseholdSummary h, HouseholdFilter f) => switch (f) {
    HouseholdFilter.all => true,
    HouseholdFilter.notVisited => h.visitStatus == VisitStatus.notVisited,
    HouseholdFilter.visited => h.visitStatus == VisitStatus.visited,
    HouseholdFilter.followUp => h.visitStatus == VisitStatus.followUp,
  };

  static String _filterLabel(AppLocalizations l10n, HouseholdFilter f) =>
      switch (f) {
        HouseholdFilter.all => l10n.householdsFilterAll,
        HouseholdFilter.notVisited => l10n.householdsFilterNotVisited,
        HouseholdFilter.visited => l10n.householdsFilterVisited,
        HouseholdFilter.followUp => l10n.householdsFilterFollowUp,
      };
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.count,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Semantics(
      // "Visited: 38 households", with the selected state.
      label: l10n.householdsFilterLabel(count, label),
      selected: selected,
      button: true,
      excludeSemantics: true,
      child: FilterChip(
        label: Text('$label $count'),
        selected: selected,
        onSelected: (_) => onSelected(),
      ),
    );
  }
}

class _HouseholdRow extends StatelessWidget {
  const _HouseholdRow({required this.household});

  final HouseholdSummary household;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final h = household;
    final status = h.lastOutcome == null
        ? l10n.householdsFilterNotVisited
        : visitOutcomeLabel(l10n, h.lastOutcome!) ??
              l10n.householdsFilterVisited;
    final sync = h.sync;
    return ListTile(
      title: Text(h.address),
      subtitle: Text('${l10n.householdMembers(h.members)} · $status'),
      trailing: sync == null
          ? null
          // At most 40% of the row, so the address keeps room; the chip's
          // word wraps at large text sizes (Telugu labels are long).
          : ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.sizeOf(context).width * 0.4,
              ),
              child: SyncStatusChip(
                status: switch (sync) {
                  HouseholdSync.uploaded => SyncStatus.synced,
                  HouseholdSync.onPhone => SyncStatus.pending,
                  HouseholdSync.chooseValue => SyncStatus.conflict,
                },
              ),
            ),
      onTap: () => context.push(Routes.household(h.id)),
    );
  }
}
