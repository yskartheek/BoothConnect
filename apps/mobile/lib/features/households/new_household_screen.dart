import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/local/local_writes.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../widgets/states.dart';
import 'household_address_screen.dart';
import 'household_screen.dart' show disabledFieldsProvider;

/// A household not on the official list: its address and location, in one
/// of the volunteer's booths. Saves on the phone and queues
/// `household.create`; works offline.
class NewHouseholdScreen extends ConsumerWidget {
  const NewHouseholdScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final stations = ref.watch(pollingStationIdsProvider);
    final disabled = ref.watch(disabledFieldsProvider);

    Widget shell(Widget body) => Scaffold(
      appBar: AppBar(title: Text(l10n.householdNewTitle)),
      body: body,
    );

    if (stations.hasError || disabled.hasError) {
      return shell(const ErrorState());
    }
    if (!stations.hasValue || !disabled.hasValue) {
      return shell(const LoadingState());
    }
    // A household goes in a booth whose households are on the phone.
    if (stations.value!.isEmpty) {
      return shell(
        EmptyState(
          icon: Icons.cloud_download_outlined,
          title: l10n.householdsEmptyTitle,
          message: l10n.householdNewNoBooth,
        ),
      );
    }
    return AddressForm(
      household: null,
      withLocation: !disabled.value!.contains(locationKey),
      stations: stations.value!,
    );
  }
}
