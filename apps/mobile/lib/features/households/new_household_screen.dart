import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../widgets/placeholder_screen.dart';

/// A household not on the roll: address and location (#115).
class NewHouseholdScreen extends StatelessWidget {
  const NewHouseholdScreen({super.key});

  @override
  Widget build(BuildContext context) =>
      PlaceholderScreen(title: AppLocalizations.of(context).householdNewTitle);
}
