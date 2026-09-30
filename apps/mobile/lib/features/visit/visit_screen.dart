import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../widgets/placeholder_screen.dart';

/// The visit form for a household (#65).
class VisitScreen extends StatelessWidget {
  const VisitScreen({super.key, required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context) =>
      PlaceholderScreen(title: AppLocalizations.of(context).visitTitle);
}
