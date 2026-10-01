import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../data/local/local_reads.dart';
import '../../data/local/local_store.dart';
import '../../data/local/local_writes.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../../widgets/sync_status_chip.dart';
import '../shared/local_watch.dart';
import 'sync_controller.dart';

final openConflictsProvider = localWatch<List<OpenConflict>>(
  (db) => db.watchOpenConflicts(),
);

final uploadQueueProvider = localWatch<List<UploadItem>>(
  (db) => db.watchUploadQueue(),
);

final ownerProvider = localWatch<String?>((db) => db.watchOwner());

/// Uploads: what's on the phone and not on the server yet. Conflicts to
/// choose a value for, changes waiting (with their next try), and changes
/// the server refused (with the reason and Retry). Most volunteers never
/// need it: everything uploads by itself.
class SyncScreen extends ConsumerWidget {
  const SyncScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final conflicts = ref.watch(openConflictsProvider);
    final queue = ref.watch(uploadQueueProvider);
    final owner = ref.watch(ownerProvider);

    final Widget body;
    if (conflicts.hasError || queue.hasError || owner.hasError) {
      body = const ErrorState();
    } else if (!conflicts.hasValue || !queue.hasValue || !owner.hasValue) {
      body = const LoadingState();
    } else {
      body = _Uploads(
        conflicts: conflicts.value!,
        queue: queue.value!,
        owner: owner.value,
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(l10n.syncTitle)),
      body: body,
    );
  }
}

class _Uploads extends ConsumerWidget {
  const _Uploads({
    required this.conflicts,
    required this.queue,
    required this.owner,
  });

  final List<OpenConflict> conflicts;
  final List<UploadItem> queue;
  final String? owner;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final online = ref.watch(onlineProvider).value ?? true;
    final waiting = queue.where((i) => i.status != 'failed').toList();
    final failed = queue.where((i) => i.status == 'failed').toList();
    final uploading = queue.where((i) => i.status == 'syncing').length;
    final sync = ref.read(syncControllerProvider.notifier);

    final status = !online
        ? (queue.isEmpty
              ? l10n.syncOfflineDone
              : l10n.syncOfflineWaiting(queue.length))
        : uploading > 0
        // Generated arguments are in alphabetical order: current, total.
        ? l10n.syncOnlineUploading(uploading, queue.length)
        : queue.isEmpty
        ? l10n.syncOnlineDone
        : l10n.syncOnlineWaiting(queue.length);

    Widget heading(String label) => Padding(
      padding: const EdgeInsets.only(top: BcSpacing.lg, bottom: BcSpacing.xs),
      child: Semantics(
        container: true,
        header: true,
        child: Text(label, style: text.titleMedium),
      ),
    );

    return ListView(
      padding: const EdgeInsets.all(BcSpacing.md),
      children: [
        GlassSurface(
          padding: const EdgeInsets.all(BcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                container: true,
                liveRegion: true,
                child: Row(
                  children: [
                    Icon(
                      online ? Icons.cloud_upload_outlined : Icons.cloud_off,
                      size: 20,
                    ),
                    const SizedBox(width: BcSpacing.xs),
                    Expanded(child: Text(status, style: text.titleSmall)),
                  ],
                ),
              ),
              const SizedBox(height: BcSpacing.xs),
              Text(l10n.syncIntro, style: text.bodySmall),
              if (queue.isNotEmpty && uploading == 0) ...[
                const SizedBox(height: BcSpacing.sm),
                OutlinedButton.icon(
                  onPressed: () => unawaited(sync.retryUploads()),
                  icon: const Icon(Icons.upload),
                  label: Text(l10n.syncUploadNow),
                ),
              ],
            ],
          ),
        ),
        if (conflicts.isNotEmpty) ...[
          heading(l10n.syncChooseTitle),
          for (final c in conflicts)
            Padding(
              padding: const EdgeInsets.only(bottom: BcSpacing.sm),
              child: _ConflictCard(
                // A new card when the pair changes, so the choice resets.
                key: ValueKey('${c.mine.id}/${c.other.id}'),
                conflict: c,
                owner: owner,
              ),
            ),
        ],
        if (waiting.isNotEmpty) ...[
          heading(l10n.syncWaitingTitle),
          Card(
            margin: EdgeInsets.zero,
            child: Column(
              children: [for (final i in waiting) _QueueRow(item: i)],
            ),
          ),
        ],
        if (failed.isNotEmpty) ...[
          heading(l10n.syncNotUploadedTitle),
          Card(
            margin: EdgeInsets.zero,
            child: Column(
              children: [for (final i in failed) _FailedRow(item: i)],
            ),
          ),
        ],
        if (conflicts.isEmpty && queue.isEmpty) ...[
          const SizedBox(height: BcSpacing.lg),
          Text(
            l10n.syncNothingWaiting,
            textAlign: TextAlign.center,
            style: text.bodyMedium,
          ),
        ],
      ],
    );
  }
}

String _locale(BuildContext context) =>
    Localizations.localeOf(context).toLanguageTag();

String _when(BuildContext context, DateTime time) =>
    DateFormat.MMMd(_locale(context)).add_jm().format(time.toLocal());

/// A value as the volunteer typed it: text and numbers as they are, an
/// address as its parts, a location as its coordinates.
String displayValue(Object? value) => switch (value) {
  null => '—',
  String() => value,
  num() || bool() => '$value',
  {'lat': final num lat, 'lng': final num lng} =>
    '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
  Map() => value.values.where((v) => v != null).join(', '),
  List() => value.join(', '),
  _ => '$value',
};

/// "Visit · 12/4 Gandhi Road", "Occupation · 12/4 Gandhi Road".
String _itemLabel(AppLocalizations l10n, UploadItem item) {
  final address = item.address ?? l10n.syncUnknownHousehold;
  return switch (item.type) {
    'visit.create' => l10n.syncItemVisit(address),
    'field.change' => l10n.syncItemChange(
      address,
      fieldLabel(l10n, item.fieldKey ?? '') ?? item.fieldKey ?? '',
    ),
    'conflict.resolve' => l10n.syncItemResolve(address),
    'household.create' => l10n.syncItemHouseholdNew(address),
    'household.update' => l10n.syncItemAddress(address),
    _ => l10n.syncItemOther(address),
  };
}

class _ConflictCard extends ConsumerStatefulWidget {
  const _ConflictCard({super.key, required this.conflict, this.owner});

  final OpenConflict conflict;
  final String? owner;

  @override
  ConsumerState<_ConflictCard> createState() => _ConflictCardState();
}

class _ConflictCardState extends ConsumerState<_ConflictCard> {
  late String _keep;
  var _saving = false;

  @override
  void initState() {
    super.initState();
    // The volunteer's own value first, else the newest.
    final values = widget.conflict.values;
    _keep = values
        .firstWhere(
          (v) => v.collectedById != null && v.collectedById == widget.owner,
          orElse: () => values.first,
        )
        .id;
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final db = await ref.read(appDatabaseProvider.future);
    await db.resolveConflict(widget.conflict, _keep);
    if (ref.read(onlineProvider).value ?? false) {
      unawaited(ref.read(syncControllerProvider.notifier).pushNow());
    }
    messenger.showSnackBar(SnackBar(content: Text(l10n.syncKept)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = widget.conflict;
    final field = fieldLabel(l10n, c.fieldKey) ?? c.fieldKey;
    final address = c.address ?? l10n.syncUnknownHousehold;
    String who(ConflictValue v) {
      final when = _when(context, v.collectedAt);
      if (v.collectedById != null && v.collectedById == widget.owner) {
        return l10n.syncValueYours(when);
      }
      final name = v.collectedByName;
      return name == null
          ? l10n.syncValueSomeone(when)
          : l10n.syncValueBy(name, when);
    }

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(BcSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Generated arguments are in alphabetical order: field, who.
            Text(
              l10n.syncConflictTitle(field, c.memberName ?? address),
              style: text.titleSmall,
            ),
            Text(l10n.syncConflictWhy(address), style: text.bodySmall),
            const SizedBox(height: BcSpacing.xs),
            RadioGroup<String>(
              groupValue: _keep,
              onChanged: (id) {
                if (id != null && !_saving) setState(() => _keep = id);
              },
              child: Column(
                children: [
                  for (final v in c.values)
                    RadioListTile<String>(
                      value: v.id,
                      contentPadding: EdgeInsets.zero,
                      title: Text(displayValue(v.value)),
                      subtitle: Text(who(v)),
                    ),
                ],
              ),
            ),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(l10n.syncKeepSelected),
            ),
          ],
        ),
      ),
    );
  }
}

class _QueueRow extends StatelessWidget {
  const _QueueRow({required this.item});

  final UploadItem item;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final next = item.nextAttemptAt;
    final detail = item.status == 'syncing'
        ? l10n.syncUploadingNow
        : next != null && next.isAfter(DateTime.now())
        ? l10n.syncNextTry(
            DateFormat.jm(_locale(context)).format(next.toLocal()),
          )
        : l10n.syncWaiting;
    return ListTile(
      title: Text(_itemLabel(l10n, item)),
      subtitle: Text(detail),
      trailing: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.4,
        ),
        child: SyncStatusChip(
          status: item.status == 'syncing'
              ? SyncStatus.syncing
              : SyncStatus.pending,
        ),
      ),
    );
  }
}

class _FailedRow extends ConsumerWidget {
  const _FailedRow({required this.item});

  final UploadItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final label = _itemLabel(l10n, item);
    final reason =
        errorMessage(l10n, item.lastError ?? '') ??
        errorMessage(l10n, 'INTERNAL_ERROR');
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        BcSpacing.md,
        BcSpacing.sm,
        BcSpacing.xs,
        BcSpacing.sm,
      ),
      // Retry below the text: long labels (Telugu, large text) never crowd
      // the reason off the row.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: text.bodyLarge),
          if (reason != null) Text(reason, style: text.bodySmall),
          Text(l10n.syncNotUploadedHelp, style: text.bodySmall),
          Semantics(
            label: l10n.syncRetryLabel(label),
            button: true,
            excludeSemantics: true,
            onTap: () => _retry(ref),
            child: TextButton(
              onPressed: () => _retry(ref),
              child: Text(l10n.syncRetry),
            ),
          ),
        ],
      ),
    );
  }

  void _retry(WidgetRef ref) =>
      unawaited(ref.read(syncControllerProvider.notifier).retryUpload(item.id));
}
