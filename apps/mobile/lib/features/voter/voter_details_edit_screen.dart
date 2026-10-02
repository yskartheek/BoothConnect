import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../data/api/api_error.dart';
import '../../data/api/providers.dart';
import '../../data/api/voter_api.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../auth/phone.dart';
import 'voter_home_screen.dart' show voterSelfProvider;

/// Editing the details a voter shares (#227): mobile number, occupation and
/// additional info. Each is current at once, as the voter's (spec v1.1).
class VoterDetailsEditScreen extends ConsumerWidget {
  const VoterDetailsEditScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final self = ref.watch(voterSelfProvider);
    return switch (self) {
      AsyncData(:final value) => _EditForm(
        // A new form when the details change, so its fields start filled.
        key: ValueKey(value.shared.map((d) => d.fieldValueId).join()),
        self: value,
      ),
      AsyncError(:final error) => Scaffold(
        appBar: AppBar(title: Text(l10n.voterEditTitle)),
        body: ErrorState(
          message: error is ApiError && error.isNetwork
              ? l10n.voterOffline
              : l10n.voterLoadFailed,
          onRetry: () => ref.invalidate(voterSelfProvider),
        ),
      ),
      _ => Scaffold(
        appBar: AppBar(title: Text(l10n.voterEditTitle)),
        body: const LoadingState(),
      ),
    };
  }
}

class _EditForm extends ConsumerStatefulWidget {
  const _EditForm({super.key, required this.self});

  final VoterSelf self;

  @override
  ConsumerState<_EditForm> createState() => _EditFormState();
}

class _EditFormState extends ConsumerState<_EditForm> {
  final _form = GlobalKey<FormState>();
  late final _controllers = {
    for (final d in widget.self.shared)
      d.key: TextEditingController(text: d.isSet ? '${d.value}' : ''),
  };
  var _saving = false;

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// What the voter typed, as the API takes it; null when empty (an emptied
  /// detail keeps its value: the API takes values, not removals).
  Object? _valueOf(String key) {
    final text = _controllers[key]!.text.trim();
    if (text.isEmpty) return null;
    return key == 'mobile_number' ? normalizePhone(text) : text;
  }

  Future<void> _save() async {
    if (_saving || !_form.currentState!.validate()) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final edits = [
      for (final d in widget.self.shared)
        if (_valueOf(d.key) case final Object value when value != d.value)
          DetailEdit(key: d.key, value: value, baseVersion: d.fieldValueId),
    ];
    if (edits.isEmpty) {
      _close();
      return;
    }
    setState(() => _saving = true);
    final List<DetailResult> results;
    try {
      results = await ref.read(voterApiProvider).editDetails(edits);
    } on ApiError catch (e) {
      if (mounted) setState(() => _saving = false);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              e.isNetwork ? l10n.voterOffline : l10n.voterSaveFailed,
            ),
          ),
        );
      return;
    }
    // Show what's now current, whatever happened.
    ref.invalidate(voterSelfProvider);
    final conflict = results.where((r) => r.status == 'conflict').firstOrNull;
    final rejected = results.any((r) => r.status == 'rejected');
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            conflict != null
                ? l10n.voterConflict(
                    // Lower case mid-sentence in English; Telugu has no case.
                    (fieldLabel(l10n, conflict.key) ?? conflict.key)
                        .toLowerCase(),
                  )
                : rejected
                ? l10n.voterSaveFailed
                : l10n.voterSaved,
          ),
        ),
      );
    if (mounted) _close();
  }

  void _close() =>
      context.canPop() ? context.pop() : context.go(Routes.voterDetails);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final save = _saving ? null : _save;

    Widget field(
      String key, {
      TextInputType? keyboard,
      String? helper,
      int maxLines = 1,
      String? Function(String?)? validator,
    }) => Padding(
      padding: const EdgeInsets.only(bottom: BcSpacing.sm),
      child: TextFormField(
        controller: _controllers[key],
        enabled: !_saving,
        keyboardType: keyboard,
        maxLines: maxLines,
        decoration: InputDecoration(
          labelText: fieldLabel(l10n, key) ?? key,
          helperText: helper,
          helperMaxLines: 3,
          errorMaxLines: 3,
        ),
        validator: validator,
      ),
    );

    final keys = widget.self.shared.map((d) => d.key).toSet();
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.voterEditTitle),
        actions: [
          if (ios)
            TextButton(onPressed: save, child: Text(l10n.memberSave))
          else
            IconButton(
              onPressed: save,
              icon: const Icon(Icons.check),
              tooltip: l10n.memberSave,
            ),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(BcSpacing.md),
          children: [
            if (keys.contains('mobile_number'))
              field(
                'mobile_number',
                keyboard: TextInputType.phone,
                helper: l10n.voterMobileHelp,
                validator: (v) {
                  final s = (v ?? '').trim();
                  return s.isEmpty || normalizePhone(s) != null
                      ? null
                      : l10n.memberMobileInvalid;
                },
              ),
            if (keys.contains('occupation')) field('occupation'),
            if (keys.contains('additional_info'))
              field(
                'additional_info',
                maxLines: 4,
                helper: l10n.memberAdditionalInfoHint,
              ),
            const SizedBox(height: BcSpacing.sm),
            Text(
              l10n.voterSharedNote,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
