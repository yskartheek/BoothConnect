import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/router.dart';
import '../../data/local/app_database.dart';
import '../../data/local/local_reads.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../../widgets/sync_status_chip.dart';
import '../shared/local_watch.dart';

final householdProvider = localWatchFamily<HouseholdRow?, String>(
  (db, id) => db.watchHousehold(id),
);

/// Null when the household isn't on the roll (removed, or not on this phone).
final householdSummaryProvider = localWatchFamily<HouseholdSummary?, String>(
  (db, id) => db
      .watchHouseholdSummaries(householdId: id)
      .map((rows) => rows.firstOrNull),
);

final memberCardsProvider = localWatchFamily<List<MemberCard>, String>(
  (db, householdId) => db.watchMemberCards(householdId),
);

final disabledFieldsProvider = localWatch<Set<String>>(
  (db) => db.watchDisabledFieldKeys(),
);

/// One household: its address and location, its members, and Start visit.
/// Reads the phone's database only. Fields no longer collected (disabled)
/// are never shown.
class HouseholdScreen extends ConsumerWidget {
  const HouseholdScreen({super.key, required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    // A bottom button on iOS, an extended floating button on Android.
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final household = ref.watch(householdProvider(householdId));
    final summary = ref.watch(householdSummaryProvider(householdId));
    final members = ref.watch(memberCardsProvider(householdId));
    final disabled = ref.watch(disabledFieldsProvider);

    void startVisit() => context.push(Routes.visit(householdId));

    final Widget body;
    var found = false;
    if (household.hasError ||
        summary.hasError ||
        members.hasError ||
        disabled.hasError) {
      body = const ErrorState();
    } else if (!household.hasValue ||
        !summary.hasValue ||
        !members.hasValue ||
        !disabled.hasValue) {
      body = const LoadingState();
    } else if (household.value == null || summary.value == null) {
      body = EmptyState(
        icon: Icons.home_work_outlined,
        title: l10n.householdNotFoundTitle,
        message: l10n.householdNotFoundMessage,
      );
    } else {
      found = true;
      body = _Details(
        household: household.value!,
        summary: summary.value!,
        members: members.value!,
        disabled: disabled.value!,
        // Room below the last card for the floating button.
        bottomPadding: ios ? BcSpacing.lg : BcSpacing.xxl * 2,
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.householdTitle),
        actions: [
          if (found)
            TextButton.icon(
              onPressed: () =>
                  context.push(Routes.householdAddress(householdId)),
              icon: const Icon(Icons.edit_outlined),
              label: Text(l10n.householdEdit),
            ),
        ],
      ),
      body: body,
      floatingActionButton: found && !ios
          ? FloatingActionButton.extended(
              onPressed: startVisit,
              icon: const Icon(Icons.play_arrow),
              label: Text(l10n.householdStartVisit),
            )
          : null,
      bottomNavigationBar: found && ios
          ? SafeArea(
              minimum: const EdgeInsets.fromLTRB(
                BcSpacing.md,
                BcSpacing.xs,
                BcSpacing.md,
                BcSpacing.md,
              ),
              child: FilledButton(
                onPressed: startVisit,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(BcTouchTarget.android),
                ),
                child: Text(l10n.householdStartVisit),
              ),
            )
          : null,
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({
    required this.household,
    required this.summary,
    required this.members,
    required this.disabled,
    required this.bottomPadding,
  });

  final HouseholdRow household;
  final HouseholdSummary summary;
  final List<MemberCard> members;
  final Set<String> disabled;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return ListView(
      padding: EdgeInsets.fromLTRB(
        BcSpacing.md,
        BcSpacing.sm,
        BcSpacing.md,
        bottomPadding,
      ),
      children: [
        _AddressCard(
          household: household,
          summary: summary,
          disabled: disabled,
        ),
        const SizedBox(height: BcSpacing.lg),
        // Side by side; the button goes below the heading when both don't
        // fit (large text, a small phone).
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Semantics(
              container: true,
              header: true,
              child: Text(
                l10n.householdMembersHeading(members.length),
                style: text.titleMedium,
              ),
            ),
            TextButton(
              onPressed: () => context.push(Routes.newMember(household.id)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.person_add_alt_1_outlined),
                  const SizedBox(width: BcSpacing.xs),
                  // Wraps rather than overflows at large text sizes.
                  Flexible(child: Text(l10n.householdAddMember)),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: BcSpacing.xs),
        if (members.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: BcSpacing.md),
            child: Column(
              children: [
                Text(l10n.householdNoMembersTitle, style: text.titleSmall),
                const SizedBox(height: BcSpacing.xxs),
                Text(
                  l10n.householdNoMembersMessage,
                  textAlign: TextAlign.center,
                  style: text.bodyMedium,
                ),
              ],
            ),
          )
        else
          for (final member in members)
            Padding(
              padding: const EdgeInsets.only(bottom: BcSpacing.xs),
              child: _MemberCard(member: member, disabled: disabled),
            ),
      ],
    );
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard({
    required this.household,
    required this.summary,
    required this.disabled,
  });

  final HouseholdRow household;
  final HouseholdSummary summary;
  final Set<String> disabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final h = household;

    // Area · landmark · PIN code, from the structured address.
    final details = disabled.contains('address')
        ? const <String>[]
        : _addressDetails(h.structuredAddress);
    final located =
        !disabled.contains('household_location') &&
        h.latitude != null &&
        h.longitude != null;

    final lastVisit = summary.lastVisitAt == null
        ? l10n.householdNotVisitedYet
        // Generated arguments are in alphabetical order: date, outcome.
        : l10n.householdLastVisit(
            DateFormat.MMMd(Localizations.localeOf(context).toLanguageTag())
                .format(summary.lastVisitAt!.toLocal()),
            visitOutcomeLabel(l10n, summary.lastOutcome!) ??
                l10n.householdsFilterVisited,
          );
    final sync = summary.sync;

    return GlassSurface(
      padding: const EdgeInsets.all(BcSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            container: true,
            header: true,
            child: Text(
              h.displayAddress,
              style: text.titleLarge?.copyWith(fontWeight: FontWeight.w800),
            ),
          ),
          if (details.isNotEmpty) ...[
            const SizedBox(height: BcSpacing.xxs),
            Text(details.join(' · '), style: text.bodySmall),
          ],
          if (located) ...[
            const SizedBox(height: BcSpacing.sm),
            _MapThumbnail(accuracyM: h.accuracyM),
          ],
          const SizedBox(height: BcSpacing.sm),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: BcSpacing.sm,
            runSpacing: BcSpacing.xs,
            children: [
              Text(lastVisit, style: text.bodySmall),
              if (sync != null)
                SyncStatusChip(
                  status: switch (sync) {
                    HouseholdSync.uploaded => SyncStatus.synced,
                    HouseholdSync.onPhone => SyncStatus.pending,
                    HouseholdSync.chooseValue => SyncStatus.conflict,
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }

  static List<String> _addressDetails(String? json) {
    if (json == null) return const [];
    final Object? address;
    try {
      address = jsonDecode(json);
    } on FormatException {
      return const [];
    }
    if (address is! Map<String, dynamic>) return const [];
    return [
      for (final key in const ['area', 'landmark', 'pin_code'])
        if (address[key] case final String v when v.trim().isNotEmpty) v.trim(),
    ];
  }
}

/// A drawn preview that a location is saved. It never loads map tiles: the
/// household's position isn't sent anywhere, and it works offline.
class _MapThumbnail extends StatelessWidget {
  const _MapThumbnail({this.accuracyM});

  final double? accuracyM;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      container: true,
      image: true,
      label: accuracyM == null
          ? l10n.householdLocationSaved
          : l10n.householdLocationAccuracy(accuracyM!.round()),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(BcRadius.medium),
        child: SizedBox(
          height: 96,
          width: double.infinity,
          child: CustomPaint(
            painter: _MapPainter(
              ground: colors.surfaceContainerHighest,
              road: colors.surface,
            ),
            child: Center(
              child: Icon(Icons.location_on, size: 32, color: colors.primary),
            ),
          ),
        ),
      ),
    );
  }
}

class _MapPainter extends CustomPainter {
  const _MapPainter({required this.ground, required this.road});

  final Color ground;
  final Color road;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = ground);
    final paint = Paint()
      ..color = road
      ..strokeWidth = 10
      ..style = PaintingStyle.stroke;
    canvas
      ..drawLine(
        Offset(0, size.height * 0.62),
        Offset(size.width, size.height * 0.38),
        paint,
      )
      ..drawLine(
        Offset(size.width * 0.3, 0),
        Offset(size.width * 0.38, size.height),
        paint..strokeWidth = 6,
      );
  }

  @override
  bool shouldRepaint(_MapPainter old) =>
      old.ground != ground || old.road != road;
}

class _MemberCard extends StatelessWidget {
  const _MemberCard({required this.member, required this.disabled});

  final MemberCard member;
  final Set<String> disabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final m = member;
    final age = disabled.contains('age') ? null : m.age;
    final gender = disabled.contains('gender') || m.gender == null
        ? null
        : genderLabel(l10n, m.gender!);
    final occupation = disabled.contains('occupation') ? null : m.occupation;

    // "46 · Female · Teacher"; screen readers hear "Age 46".
    final shown = [?age?.toString(), ?gender, ?occupation];
    final spoken = [
      ?(age == null ? null : l10n.memberAge(age)),
      ?gender,
      ?occupation,
    ];

    void open() => context.push(Routes.member(m.id));
    return Card(
      margin: EdgeInsets.zero,
      child: Semantics(
        button: true,
        label: [m.name, ...spoken].join(', '),
        onTap: open,
        excludeSemantics: true,
        child: ListTile(
          leading: CircleAvatar(child: Text(m.initials)),
          title: Text(m.name),
          subtitle: shown.isEmpty ? null : Text(shown.join(' · ')),
          onTap: open,
        ),
      ),
    );
  }
}
