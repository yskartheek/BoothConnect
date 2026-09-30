import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../data/local/local_reads.dart';
import '../../data/local/local_store.dart';
import '../../data/local/local_writes.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../households/household_screen.dart';
import '../shared/local_watch.dart';

/// Visit outcomes (API codes), the common ones first.
const commonOutcomes = [
  'completed',
  'partially_completed',
  'no_one_available',
  'refused',
  'follow_up_requested',
];
const otherOutcomes = [
  'address_not_found',
  'household_moved',
  'voter_deceased',
  'duplicate_or_incorrect_listing',
  'unsafe_or_inaccessible',
];

/// Saved as soon as they're chosen: there's nothing more to ask.
const quickOutcomes = {'no_one_available', 'refused'};

/// Outcomes where the volunteer met someone: ask who.
const metOutcomes = {'completed', 'partially_completed', 'follow_up_requested'};

/// Member details changed on the phone during this visit, by member.
final visitChangesProvider =
    localWatchFamily<Map<String, List<String>>, (String, DateTime)>(
      (db, arg) => db.watchMemberChangesSince(arg.$1, arg.$2),
    );

/// Records a visit: the outcome, who the volunteer met (editing their
/// details from here), and notes. Saved on the phone and queued for upload,
/// so it works offline.
class VisitScreen extends ConsumerStatefulWidget {
  const VisitScreen({super.key, required this.householdId});

  final String householdId;

  @override
  ConsumerState<VisitScreen> createState() => _VisitScreenState();
}

class _VisitScreenState extends ConsumerState<VisitScreen> {
  final _startedAt = DateTime.now();
  final _notes = TextEditingController();
  final _met = <String>{};
  String? _outcome;
  var _allOptions = false;
  var _saving = false;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save(String outcome) async {
    if (_saving) return;
    setState(() => _saving = true);
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final db = await ref.read(appDatabaseProvider.future);
      await db.recordVisit(
        householdId: widget.householdId,
        outcome: outcome,
        startedAt: _startedAt,
        completedAt: DateTime.now(),
        memberIdsMet: metOutcomes.contains(outcome) ? [..._met] : const [],
        notes: _notes.text,
      );
    } on Object {
      if (mounted) setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(l10n.visitSaveFailed)));
      return;
    }
    messenger.showSnackBar(SnackBar(content: Text(l10n.visitSaved)));
    if (mounted) _close();
  }

  /// Back to the household (opened from a link, there's nothing to pop).
  void _close() => context.canPop()
      ? context.pop()
      : context.go(Routes.household(widget.householdId));

  void _choose(String outcome) {
    setState(() => _outcome = outcome);
    // Refused or No one home: saved at once, no further questions.
    if (quickOutcomes.contains(outcome)) unawaited(_save(outcome));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final id = widget.householdId;
    final summary = ref.watch(householdSummaryProvider(id));
    final members = ref.watch(memberCardsProvider(id));
    final changes = ref.watch(visitChangesProvider((id, _startedAt)));

    final Widget body;
    if (summary.hasError || members.hasError || changes.hasError) {
      body = const ErrorState();
    } else if (!summary.hasValue || !members.hasValue || !changes.hasValue) {
      body = const LoadingState();
    } else if (summary.value == null) {
      body = EmptyState(
        icon: Icons.home_work_outlined,
        title: l10n.householdNotFoundTitle,
        message: l10n.householdNotFoundMessage,
      );
    } else {
      body = _form(context, members.value!, changes.value!);
    }

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          tooltip: l10n.visitCancel,
          onPressed: _close,
        ),
        title: Text(
          summary.value == null
              ? l10n.visitTitle
              : l10n.visitTitleFor(summary.value!.address),
        ),
      ),
      body: body,
    );
  }

  Widget _form(
    BuildContext context,
    List<MemberCard> members,
    Map<String, List<String>> changes,
  ) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final outcome = _outcome;
    final outcomes = [
      ...commonOutcomes,
      // A rarer outcome stays visible once chosen.
      if (_allOptions) ...otherOutcomes,
      if (!_allOptions && otherOutcomes.contains(outcome)) outcome!,
    ];

    return ListView(
      padding: const EdgeInsets.all(BcSpacing.md),
      children: [
        _heading(text, l10n.visitHowDidItGo),
        const SizedBox(height: BcSpacing.xs),
        Wrap(
          spacing: BcSpacing.xs,
          runSpacing: BcSpacing.xs,
          children: [
            for (final code in outcomes)
              ChoiceChip(
                label: Text(visitOutcomeLabel(l10n, code) ?? code),
                selected: outcome == code,
                onSelected: _saving ? null : (_) => _choose(code),
              ),
            ActionChip(
              label: Text(
                _allOptions ? l10n.visitFewerOptions : l10n.visitMoreOptions,
              ),
              onPressed: () => setState(() => _allOptions = !_allOptions),
            ),
          ],
        ),
        if (metOutcomes.contains(outcome) && members.isNotEmpty) ...[
          const SizedBox(height: BcSpacing.lg),
          _heading(text, l10n.visitWhoDidYouMeet),
          const SizedBox(height: BcSpacing.xs),
          Card(
            margin: EdgeInsets.zero,
            child: Column(
              children: [
                for (final m in members)
                  _MemberRow(
                    member: m,
                    met: _met.contains(m.id),
                    changed: changes[m.id] ?? const [],
                    onMet: (met) => setState(
                      () => met ? _met.add(m.id) : _met.remove(m.id),
                    ),
                  ),
              ],
            ),
          ),
        ],
        const SizedBox(height: BcSpacing.lg),
        TextField(
          controller: _notes,
          minLines: 2,
          maxLines: 5,
          maxLength: 1000,
          decoration: InputDecoration(
            labelText: l10n.visitNotes,
            helperText: l10n.visitNotesHint,
            helperMaxLines: 3,
          ),
        ),
        const SizedBox(height: BcSpacing.md),
        FilledButton(
          onPressed: outcome == null || _saving ? null : () => _save(outcome),
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(BcTouchTarget.android),
          ),
          child: Text(l10n.visitSave),
        ),
        if (outcome == null) ...[
          const SizedBox(height: BcSpacing.xs),
          Text(
            l10n.visitChooseOutcome,
            textAlign: TextAlign.center,
            style: text.bodySmall,
          ),
        ],
      ],
    );
  }

  static Widget _heading(TextTheme text, String label) => Semantics(
    container: true,
    header: true,
    child: Text(label, style: text.titleMedium),
  );
}

class _MemberRow extends StatelessWidget {
  const _MemberRow({
    required this.member,
    required this.met,
    required this.changed,
    required this.onMet,
  });

  final MemberCard member;
  final bool met;
  final List<String> changed;
  final ValueChanged<bool> onMet;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // "Updated mobile number, occupation", else whether they were met.
    final summary = changed.isNotEmpty
        ? l10n.visitUpdated(
            changed
                .map((key) => fieldLabel(l10n, key)?.toLowerCase() ?? key)
                .join(', '),
          )
        : met
        ? l10n.visitNoChanges
        : l10n.visitNotMet;
    return Row(
      children: [
        Expanded(
          child: CheckboxListTile(
            value: met,
            onChanged: (value) => onMet(value ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(member.name),
            subtitle: Text(summary),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(right: BcSpacing.xs),
          child: Semantics(
            label: l10n.visitEditMemberLabel(member.name),
            excludeSemantics: true,
            button: true,
            onTap: () => context.push(Routes.member(member.id)),
            child: TextButton(
              onPressed: () => context.push(Routes.member(member.id)),
              child: Text(l10n.visitEditMember),
            ),
          ),
        ),
      ],
    );
  }
}
