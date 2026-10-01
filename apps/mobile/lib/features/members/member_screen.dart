import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../data/local/app_database.dart';
import '../../data/local/local_reads.dart';
import '../../data/local/local_store.dart';
import '../../data/local/local_writes.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import '../auth/phone.dart';
import '../home/home_screen.dart' show boothsProvider;
import '../shared/local_watch.dart';
import '../sync/sync_controller.dart';

final memberDetailProvider = localWatchFamily<MemberDetail?, String>(
  (db, id) => db.watchMemberDetail(id),
);

final fieldDefinitionsProvider = localWatch<Map<String, FieldDefinitionRow>>(
  (db) => db.watchFieldDefinitions(),
);

/// The restricted detail collected only with the member's consent.
const casteKey = 'caste_community';

/// A member's details, all editable: name, age, gender, mobile, occupation,
/// caste / community (with the member's consent) and additional info. The
/// same screen adds someone who isn't on the official list. Saves on the
/// phone and queues the changes; works offline.
class MemberScreen extends ConsumerWidget {
  const MemberScreen({super.key, required String this.memberId})
    : householdId = null;

  /// Someone who lives in [householdId] but isn't on the official list.
  const MemberScreen.add({super.key, required String this.householdId})
    : memberId = null;

  final String? memberId;
  final String? householdId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final definitions = ref.watch(fieldDefinitionsProvider);
    final member = memberId == null
        ? const AsyncValue<MemberDetail?>.data(null)
        : ref.watch(memberDetailProvider(memberId!));

    if (definitions.hasError || member.hasError) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.memberTitle)),
        body: const ErrorState(),
      );
    }
    if (!definitions.hasValue || !member.hasValue) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.memberTitle)),
        body: const LoadingState(),
      );
    }
    if (memberId != null && member.value == null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.memberTitle)),
        body: EmptyState(
          icon: Icons.person_off_outlined,
          title: l10n.memberNotFoundTitle,
          message: l10n.memberNotFoundMessage,
        ),
      );
    }
    return _MemberForm(
      // A new form when the member is loaded, so its fields start filled.
      key: ValueKey(memberId ?? 'new:$householdId'),
      detail: member.value,
      householdId: member.value?.voter.householdId ?? householdId!,
      definitions: definitions.value!,
    );
  }
}

class _MemberForm extends ConsumerStatefulWidget {
  const _MemberForm({
    super.key,
    required this.detail,
    required this.householdId,
    required this.definitions,
  });

  /// Null when adding a member.
  final MemberDetail? detail;
  final String householdId;
  final Map<String, FieldDefinitionRow> definitions;

  @override
  ConsumerState<_MemberForm> createState() => _MemberFormState();
}

class _MemberFormState extends ConsumerState<_MemberForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: _initial('name'));
  late final _age = TextEditingController(text: _initial('age'));
  late final _mobile = TextEditingController(text: _initial('mobile_number'));
  late final _occupation = TextEditingController(text: _initial('occupation'));
  late final _info = TextEditingController(text: _initial('additional_info'));
  final _caste = TextEditingController();
  late String? _gender = _string(widget.detail?.value('gender'));
  var _agreed = false;
  var _saving = false;

  bool get _adding => widget.detail == null;

  @override
  void dispose() {
    for (final c in [_name, _age, _mobile, _occupation, _info, _caste]) {
      c.dispose();
    }
    super.dispose();
  }

  String _initial(String key) => switch (widget.detail?.value(key)) {
    null => '',
    final String s => s,
    final num n => '${n.toInt()}',
    final Object other => '$other',
  };

  static String? _string(Object? v) => v is String && v.isNotEmpty ? v : null;

  /// Shown unless the admin turned it off. Caste needs its definition (its
  /// consent purpose).
  bool _shows(String key) {
    final definition = widget.definitions[key];
    if (key == casteKey) return definition?.enabled ?? false;
    return definition?.enabled ?? true;
  }

  /// The choices of a select field, or null for free text.
  List<String>? _options(String key) {
    final raw = widget.definitions[key]?.options;
    if (raw == null) return null;
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded is! List<dynamic> || decoded.isEmpty) return null;
    return [
      for (final o in decoded)
        if (o is Map<String, dynamic> && o['value'] is String)
          o['value'] as String
        else if (o is String)
          o,
    ];
  }

  Future<void> _save() async {
    if (_saving || !_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final db = await ref.read(appDatabaseProvider.future);
      final now = DateTime.now();
      final name = _name.text.trim();
      final age = int.tryParse(_age.text.trim());
      final mobile = _mobile.text.trim().isEmpty
          ? null
          : normalizePhone(_mobile.text);
      final others = <String, String>{
        'mobile_number': ?mobile,
        if (_occupation.text.trim().isNotEmpty)
          'occupation': _occupation.text.trim(),
        if (_info.text.trim().isNotEmpty) 'additional_info': _info.text.trim(),
      };

      final String memberId;
      if (_adding) {
        memberId = await db.addMember(
          householdId: widget.householdId,
          name: name,
          age: _shows('age') ? age : null,
          gender: _shows('gender') ? _gender : null,
          fields: {
            for (final e in others.entries)
              if (_shows(e.key)) e.key: e.value,
          },
          at: now,
        );
      } else {
        final detail = widget.detail!;
        memberId = detail.voter.id;
        // Only what changed. An emptied detail keeps its value: the API
        // takes values, not removals.
        final changes = <String, Object>{
          'name': name,
          'age': ?age,
          'gender': ?_gender,
          ...others,
        };
        for (final MapEntry(:key, :value) in changes.entries) {
          if (!_shows(key) || detail.value(key) == value) continue;
          if (key == 'age' &&
              detail.value(key) is num &&
              (detail.value(key)! as num).toInt() == value) {
            continue;
          }
          await db.changeField(
            entityType: 'voter',
            entityId: memberId,
            householdId: widget.householdId,
            fieldKey: key,
            value: value,
            at: now,
          );
        }
      }

      // Caste / community: only with the member's consent, recorded first.
      final caste = _caste.text.trim();
      if (_shows(casteKey) && _agreed && caste.isNotEmpty) {
        final consentId = await db.captureConsent(
          voterId: memberId,
          householdId: widget.householdId,
          purpose: casteKey,
          at: now,
        );
        await db.queueRestrictedField(
          voterId: memberId,
          householdId: widget.householdId,
          fieldKey: casteKey,
          value: caste,
          consentId: consentId,
          at: now,
        );
      }
    } on Object {
      if (mounted) setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(l10n.memberSaveFailed)));
      return;
    }
    if (ref.read(onlineProvider).value ?? false) {
      unawaited(ref.read(syncControllerProvider.notifier).pushNow());
    }
    messenger.showSnackBar(SnackBar(content: Text(l10n.memberSaved)));
    if (!mounted) return;
    context.canPop()
        ? context.pop()
        : context.go(Routes.household(widget.householdId));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final detail = widget.detail;
    final title = _adding
        ? l10n.memberAddTitle
        : _string(detail!.value('name')) ?? l10n.memberTitle;

    final epic = detail?.voter.epicNumber;
    final booths = ref.watch(boothsProvider).value ?? const [];
    final reference = epic == null
        ? null
        // Generated arguments are in alphabetical order: booth, epic.
        : booths.length == 1
        ? l10n.memberOfficialRef(booths.single.code, epic)
        : l10n.memberOfficialRefNoBooth(epic);

    String label(String key) => fieldLabel(l10n, key) ?? key;

    Widget textField(
      String key,
      TextEditingController controller, {
      TextInputType? keyboard,
      String? Function(String?)? validator,
      String? helper,
      int? maxLines = 1,
    }) {
      final options = _options(key);
      if (options != null) {
        final current = controller.text;
        return DropdownButtonFormField<String>(
          initialValue: options.contains(current) ? current : null,
          isExpanded: true,
          decoration: InputDecoration(labelText: label(key)),
          hint: Text(l10n.memberChoose),
          items: [
            for (final o in options) DropdownMenuItem(value: o, child: Text(o)),
          ],
          onChanged: _saving ? null : (v) => controller.text = v ?? '',
        );
      }
      return TextFormField(
        controller: controller,
        enabled: !_saving,
        keyboardType: keyboard,
        maxLines: maxLines,
        decoration: InputDecoration(
          labelText: label(key),
          helperText: helper,
          helperMaxLines: 3,
        ),
        validator: validator,
      );
    }

    final save = _saving ? null : _save;
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
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
            if (reference != null) ...[
              Text(
                reference,
                textAlign: TextAlign.center,
                style: text.bodySmall,
              ),
              const SizedBox(height: BcSpacing.sm),
            ],
            textField(
              'name',
              _name,
              validator: (v) =>
                  (v ?? '').trim().isEmpty ? l10n.memberNameRequired : null,
            ),
            if (_shows('age')) ...[
              const SizedBox(height: BcSpacing.sm),
              textField(
                'age',
                _age,
                keyboard: TextInputType.number,
                validator: (v) {
                  final s = (v ?? '').trim();
                  if (s.isEmpty) return null;
                  final n = int.tryParse(s);
                  return n == null || n < 0 || n > 130
                      ? l10n.memberAgeInvalid
                      : null;
                },
              ),
            ],
            if (_shows('gender')) ...[
              const SizedBox(height: BcSpacing.md),
              Text(label('gender'), style: text.labelLarge),
              const SizedBox(height: BcSpacing.xs),
              SegmentedButton<String>(
                segments: [
                  for (final g in const ['female', 'male', 'third_gender'])
                    ButtonSegment(
                      value: g,
                      label: Text(genderLabel(l10n, g) ?? g),
                    ),
                ],
                selected: {?_gender},
                emptySelectionAllowed: true,
                showSelectedIcon: false,
                onSelectionChanged: _saving
                    ? null
                    : (s) => setState(() => _gender = s.firstOrNull),
              ),
            ],
            if (_shows('mobile_number')) ...[
              const SizedBox(height: BcSpacing.sm),
              textField(
                'mobile_number',
                _mobile,
                keyboard: TextInputType.phone,
                validator: (v) {
                  final s = (v ?? '').trim();
                  return s.isEmpty || normalizePhone(s) != null
                      ? null
                      : l10n.memberMobileInvalid;
                },
              ),
            ],
            if (_shows('occupation')) ...[
              const SizedBox(height: BcSpacing.sm),
              textField('occupation', _occupation),
            ],
            if (_shows(casteKey)) ...[
              const SizedBox(height: BcSpacing.lg),
              _CasteCard(
                agreed: _agreed,
                waiting: detail?.waitingRestricted.contains(casteKey) ?? false,
                enabled: !_saving,
                onAgreed: (v) => setState(() => _agreed = v),
                field: textField(casteKey, _caste),
              ),
            ],
            if (_shows('additional_info')) ...[
              const SizedBox(height: BcSpacing.lg),
              textField(
                'additional_info',
                _info,
                maxLines: 4,
                helper: l10n.memberAdditionalInfoHint,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Caste / community: marked Sensitive, and locked until the member agrees
/// to share it.
class _CasteCard extends StatelessWidget {
  const _CasteCard({
    required this.agreed,
    required this.waiting,
    required this.enabled,
    required this.onAgreed,
    required this.field,
  });

  final bool agreed;
  final bool waiting;
  final bool enabled;
  final ValueChanged<bool> onAgreed;
  final Widget field;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(BcSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: BcSpacing.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(l10n.consentCasteTitle, style: text.titleSmall),
                Chip(
                  label: Text(l10n.memberSensitive),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            Text(l10n.consentCasteNotice, style: text.bodySmall),
            if (waiting) ...[
              const SizedBox(height: BcSpacing.xs),
              Text(l10n.memberCasteWaiting, style: text.bodySmall),
            ],
            CheckboxListTile(
              value: agreed,
              onChanged: enabled ? (v) => onAgreed(v ?? false) : null,
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.consentCasteAgree),
            ),
            // Locked until the member agrees.
            if (agreed) field,
          ],
        ),
      ),
    );
  }
}
