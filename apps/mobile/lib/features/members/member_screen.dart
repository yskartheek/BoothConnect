import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../widgets/placeholder_screen.dart';

/// A member's details, or a new member of a household (#114).
class MemberScreen extends StatelessWidget {
  const MemberScreen({super.key, required String this.memberId})
    : householdId = null;

  /// Someone who lives in [householdId] but isn't on the official list.
  const MemberScreen.add({super.key, required String this.householdId})
    : memberId = null;

  final String? memberId;
  final String? householdId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PlaceholderScreen(
      title: memberId == null ? l10n.memberAddTitle : l10n.memberTitle,
    );
  }
}
