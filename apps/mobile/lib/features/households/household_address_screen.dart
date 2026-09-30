import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../widgets/placeholder_screen.dart';

/// A household's structured address and location (#115).
class HouseholdAddressScreen extends StatelessWidget {
  const HouseholdAddressScreen({super.key, required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context) => PlaceholderScreen(
    title: AppLocalizations.of(context).householdAddressTitle,
  );
}
