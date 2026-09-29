import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../widgets/placeholder_screen.dart';

/// One household: address, members, Start visit (#64).
class HouseholdScreen extends StatelessWidget {
  const HouseholdScreen({super.key, required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context) =>
      PlaceholderScreen(title: AppLocalizations.of(context).householdTitle);
}
