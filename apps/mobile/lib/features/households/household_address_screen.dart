import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/router.dart';
import '../../data/local/app_database.dart';
import '../../data/local/local_reads.dart';
import '../../data/local/local_store.dart';
import '../../data/local/local_writes.dart';
import '../../data/location/location_reader.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/map_thumbnail.dart';
import '../../widgets/states.dart';
import '../home/home_screen.dart' show boothsProvider;
import '../shared/local_watch.dart';
import '../sync/sync_controller.dart';
import 'household_screen.dart' show disabledFieldsProvider, householdProvider;

/// The booths of the households on the phone, for Add household.
final pollingStationIdsProvider = localWatch<List<String>>(
  (db) => db.watchPollingStationIds(),
);

/// The address parts, in the order of the form.
const _parts = ['house_no', 'street', 'area', 'pin_code', 'landmark'];

/// A household's structured address and its location: house no., street,
/// area, PIN code and landmark, and one tap to take the phone's location
/// (with the household's consent). Saves on the phone and queues the change;
/// works offline.
class HouseholdAddressScreen extends ConsumerWidget {
  const HouseholdAddressScreen({super.key, required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final household = ref.watch(householdProvider(householdId));
    final disabled = ref.watch(disabledFieldsProvider);
    if (household.hasError || disabled.hasError) {
      return _Shell(
        title: l10n.householdAddressTitle,
        body: const ErrorState(),
      );
    }
    if (!household.hasValue || !disabled.hasValue) {
      return _Shell(
        title: l10n.householdAddressTitle,
        body: const LoadingState(),
      );
    }
    if (household.value == null) {
      return _Shell(
        title: l10n.householdAddressTitle,
        body: EmptyState(
          icon: Icons.home_work_outlined,
          title: l10n.householdNotFoundTitle,
          message: l10n.householdNotFoundMessage,
        ),
      );
    }
    return AddressForm(
      key: ValueKey(householdId),
      household: household.value,
      withLocation: !disabled.value!.contains(locationKey),
    );
  }
}

class _Shell extends StatelessWidget {
  const _Shell({required this.title, required this.body});

  final String title;
  final Widget body;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title)),
    body: body,
  );
}

/// The address form; without [household], it adds a new one (#115).
class AddressForm extends ConsumerStatefulWidget {
  const AddressForm({
    super.key,
    required this.household,
    required this.withLocation,
    this.stations = const [],
  });

  /// Null when adding a household.
  final HouseholdRow? household;

  /// False when the admin turned the location field off.
  final bool withLocation;

  /// The booths a new household can go in (adding only).
  final List<String> stations;

  @override
  ConsumerState<AddressForm> createState() => _AddressFormState();
}

class _AddressFormState extends ConsumerState<AddressForm> {
  final _form = GlobalKey<FormState>();
  late final Map<String, String> _initial = _structured(
    widget.household?.structuredAddress,
  );
  late final _controllers = {
    for (final part in _parts)
      part: TextEditingController(text: _initial[part] ?? ''),
  };
  late String? _station = widget.stations.firstOrNull;

  /// A reading taken on this screen, not saved yet.
  HouseholdLocation? _reading;
  var _agreed = false;
  var _taking = false;
  LocationProblem? _problem;
  var _saving = false;
  String? _houseNoTaken;

  bool get _adding => widget.household == null;

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  static Map<String, String> _structured(String? json) {
    if (json == null) return const {};
    final Object? decoded;
    try {
      decoded = jsonDecode(json);
    } on FormatException {
      return const {};
    }
    if (decoded is! Map<String, dynamic>) return const {};
    return {
      for (final MapEntry(:key, :value) in decoded.entries)
        if (value is String) key: value,
    };
  }

  Map<String, String> get _address => {
    for (final MapEntry(:key, :value) in _controllers.entries) key: value.text,
  };

  Future<void> _takeLocation() async {
    if (_taking) return;
    setState(() {
      _taking = true;
      _problem = null;
    });
    try {
      final fix = await ref.read(locationReaderProvider).current();
      if (!mounted) return;
      setState(
        () => _reading = HouseholdLocation(
          lat: fix.lat,
          lng: fix.lng,
          accuracyM: fix.accuracyM,
          capturedAt: fix.capturedAt,
        ),
      );
    } on LocationFailure catch (e) {
      if (mounted) setState(() => _problem = e.problem);
    } finally {
      if (mounted) setState(() => _taking = false);
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _houseNoTaken = null);
    if (!_form.currentState!.validate()) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final address = cleanAddress(_address);
    final changed = !_sameAddress(address, cleanAddress(_initial));
    if (!_adding && !changed && _reading == null) {
      _close(widget.household!.id);
      return;
    }
    setState(() => _saving = true);
    final String id;
    try {
      final db = await ref.read(appDatabaseProvider.future);
      final now = DateTime.now();
      if (_adding) {
        id = await db.addHousehold(
          pollingStationId: _station!,
          address: address,
          location: _reading,
          at: now,
        );
      } else {
        id = widget.household!.id;
        await db.updateHousehold(
          householdId: id,
          address: changed ? address : null,
          location: _reading,
          at: now,
        );
      }
    } on HouseNumberTaken {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _houseNoTaken = l10n.addressHouseNoTaken;
      });
      _form.currentState!.validate();
      return;
    } on Object {
      if (mounted) setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(l10n.addressSaveFailed)));
      return;
    }
    if (ref.read(onlineProvider).value ?? false) {
      unawaited(ref.read(syncControllerProvider.notifier).pushNow());
    }
    messenger.showSnackBar(
      SnackBar(
        content: Text(_adding ? l10n.householdAdded : l10n.addressSaved),
      ),
    );
    if (!mounted) return;
    if (_adding) {
      context.pushReplacement(Routes.household(id));
    } else {
      _close(id);
    }
  }

  void _close(String id) =>
      context.canPop() ? context.pop() : context.go(Routes.household(id));

  static bool _sameAddress(Map<String, String> a, Map<String, String> b) =>
      a.length == b.length && a.entries.every((e) => b[e.key] == e.value);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final title = _adding ? l10n.householdNewTitle : l10n.householdAddressTitle;
    final save = _saving ? null : _save;

    Widget field(
      String part,
      String label, {
      TextInputType? keyboard,
      String? Function(String?)? validator,
    }) => TextFormField(
      controller: _controllers[part],
      enabled: !_saving,
      keyboardType: keyboard,
      textInputAction: TextInputAction.next,
      decoration: InputDecoration(labelText: label),
      validator: validator,
    );

    final houseNo = field(
      'house_no',
      l10n.addressHouseNo,
      validator: (_) => _houseNoTaken,
    );
    final street = field(
      'street',
      l10n.addressStreet,
      validator: (_) =>
          cleanAddress(_address).isEmpty ? l10n.addressRequired : null,
    );
    final pin = field(
      'pin_code',
      l10n.addressPinCode,
      keyboard: TextInputType.number,
      validator: (v) {
        final s = (v ?? '').trim();
        return s.isEmpty || RegExp(r'^\d{6}$').hasMatch(s)
            ? null
            : l10n.addressPinInvalid;
      },
    );
    final landmark = field('landmark', l10n.addressLandmark);

    final booths = ref.watch(boothsProvider).value ?? const [];
    String boothLabel(String id) {
      final booth = booths.where((b) => b.id == id).firstOrNull;
      // Generated arguments are in alphabetical order: code, name.
      return booth == null ? id : l10n.homeBoothLine(booth.code, booth.name);
    }

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
            if (_adding && widget.stations.length > 1) ...[
              DropdownButtonFormField<String>(
                initialValue: _station,
                isExpanded: true,
                decoration: InputDecoration(labelText: l10n.addressBooth),
                items: [
                  for (final s in widget.stations)
                    DropdownMenuItem(value: s, child: Text(boothLabel(s))),
                ],
                onChanged: _saving
                    ? null
                    : (v) => setState(() => _station = v ?? _station),
              ),
              const SizedBox(height: BcSpacing.sm),
            ],
            _Pair(first: houseNo, second: street),
            const SizedBox(height: BcSpacing.sm),
            field('area', l10n.addressArea),
            const SizedBox(height: BcSpacing.sm),
            _Pair(first: pin, second: landmark),
            if (widget.withLocation) ...[
              const SizedBox(height: BcSpacing.lg),
              _LocationCard(
                household: widget.household,
                reading: _reading,
                agreed: _agreed,
                taking: _taking,
                problem: _problem,
                enabled: !_saving,
                // Untick: a reading taken with the agreement goes too.
                onAgreed: (v) => setState(() {
                  _agreed = v;
                  if (!v) _reading = null;
                }),
                onTake: _takeLocation,
                onOpenSettings: () =>
                    ref.read(locationReaderProvider).openSettings(),
              ),
              const SizedBox(height: BcSpacing.sm),
              Text(
                l10n.locationFootnote,
                textAlign: TextAlign.center,
                style: text.bodySmall,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Two fields side by side; one under the other when there isn't room
/// (a small phone, large text).
class _Pair extends StatelessWidget {
  const _Pair({required this.first, required this.second});

  final Widget first;
  final Widget second;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final scale = MediaQuery.textScalerOf(context).scale(1);
      if (constraints.maxWidth / scale < 320) {
        return Column(
          children: [
            first,
            const SizedBox(height: BcSpacing.sm),
            second,
          ],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: first),
          const SizedBox(width: BcSpacing.sm),
          Expanded(child: second),
        ],
      );
    },
  );
}

/// The household's location: a preview when there is one, its accuracy and
/// when it was taken, and the button that takes a new one, once the
/// household agrees.
class _LocationCard extends StatelessWidget {
  const _LocationCard({
    required this.household,
    required this.reading,
    required this.agreed,
    required this.taking,
    required this.problem,
    required this.enabled,
    required this.onAgreed,
    required this.onTake,
    required this.onOpenSettings,
  });

  final HouseholdRow? household;
  final HouseholdLocation? reading;
  final bool agreed;
  final bool taking;
  final LocationProblem? problem;
  final bool enabled;
  final ValueChanged<bool> onAgreed;
  final VoidCallback onTake;
  final VoidCallback onOpenSettings;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;
    final h = household;
    final saved = h != null && h.latitude != null && h.longitude != null;
    final accuracy =
        reading?.accuracyM ?? (reading == null ? h?.accuracyM : null);
    final captured =
        reading?.capturedAt ?? (reading == null ? h?.locationCapturedAt : null);
    final shown = reading != null || saved;

    String? details;
    if (shown) {
      final time = captured == null
          ? null
          : DateFormat.MMMd(Localizations.localeOf(context).toLanguageTag())
                .add_jm()
                .format(captured.toLocal());
      details = switch ((accuracy, time)) {
        // Generated arguments are in alphabetical order: meters, time.
        (final double a, final String t) => l10n.locationAccuracyCaptured(
          a.round(),
          t,
        ),
        (final double a, null) => l10n.householdLocationAccuracy(a.round()),
        (null, final String t) => l10n.locationCaptured(t),
        (null, null) => null,
      };
    }

    final message = switch (problem) {
      null => null,
      LocationProblem.denied => l10n.locationDenied,
      LocationProblem.deniedForever => l10n.locationDeniedForever,
      LocationProblem.off => l10n.locationOff,
      LocationProblem.unavailable => l10n.locationUnavailable,
    };

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
                Text(l10n.locationTitle, style: text.titleSmall),
                if (shown)
                  Chip(
                    avatar: Icon(
                      reading == null ? Icons.check : Icons.schedule,
                      size: 16,
                    ),
                    label: Text(
                      reading == null ? l10n.locationSaved : l10n.locationNew,
                    ),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            const SizedBox(height: BcSpacing.xs),
            if (shown) ...[
              MapThumbnail(accuracyM: accuracy),
              if (details != null) ...[
                const SizedBox(height: BcSpacing.xs),
                Text(details, style: text.bodySmall),
              ],
            ] else
              Text(l10n.locationNone, style: text.bodySmall),
            const SizedBox(height: BcSpacing.xs),
            Text(l10n.locationConsentNotice, style: text.bodySmall),
            CheckboxListTile(
              value: agreed,
              onChanged: enabled ? (v) => onAgreed(v ?? false) : null,
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.locationConsentAgree),
            ),
            OutlinedButton.icon(
              onPressed: enabled && agreed && !taking ? onTake : null,
              icon: taking
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.my_location),
              label: Text(
                taking ? l10n.locationTaking : l10n.locationUseCurrent,
              ),
            ),
            if (message != null) ...[
              const SizedBox(height: BcSpacing.xs),
              Semantics(
                liveRegion: true,
                child: Text(
                  message,
                  style: text.bodySmall?.copyWith(color: colors.error),
                ),
              ),
              if (problem == LocationProblem.deniedForever)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton(
                    onPressed: onOpenSettings,
                    child: Text(l10n.locationOpenSettings),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
