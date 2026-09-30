import 'dart:convert';

import 'package:drift/drift.dart';

import 'app_database.dart';

/// What screens read. They read the phone's database only, never the API,
/// so they work offline; sync keeps the database current. Watches update
/// when a pull writes new rows.
extension LocalReads on AppDatabase {
  /// The booth's households still on the roll, by house number.
  Stream<List<HouseholdRow>> watchHouseholds() =>
      (select(households)
            ..where((t) => t.status.equals('removed').not())
            ..orderBy([
              (t) => OrderingTerm(expression: t.houseKey),
              (t) => OrderingTerm(expression: t.displayAddress),
            ]))
          .watch();

  Stream<HouseholdRow?> watchHousehold(String id) =>
      (select(households)..where((t) => t.id.equals(id))).watchSingleOrNull();

  /// A household's active members, in roll order (section, then serial).
  Stream<List<VoterRow>> watchMembers(String householdId) =>
      (select(voters)
            ..where(
              (t) =>
                  t.householdId.equals(householdId) &
                  t.recordStatus.equals('active'),
            )
            ..orderBy([
              (t) => OrderingTerm(expression: t.sectionNo),
              (t) => OrderingTerm(expression: t.serialNo),
            ]))
          .watch();

  /// Households still on the roll.
  Stream<int> watchHouseholdCount() {
    final n = households.id.count();
    return (selectOnly(households)
          ..addColumns([n])
          ..where(households.status.equals('removed').not()))
        .map((row) => row.read(n)!)
        .watchSingle();
  }

  /// Households still on the roll with at least one visit, uploaded or
  /// still on the phone.
  Stream<int> watchVisitedCount() => customSelect(
    'SELECT COUNT(DISTINCT v.household_id) AS n FROM visits v '
    'JOIN households h ON h.id = v.household_id '
    "WHERE h.status != 'removed'",
    readsFrom: {visits, households},
  ).map((row) => row.read<int>('n')).watchSingle();

  /// Changes on the phone not yet uploaded (queued, failed or in conflict).
  Stream<int> watchPendingCount() {
    final n = pendingMutations.id.count();
    return (selectOnly(
      pendingMutations,
    )..addColumns([n])).map((row) => row.read(n)!).watchSingle();
  }

  /// The volunteer's booths, saved at sign-in (`sync_meta.assignments`).
  Stream<List<BoothAssignment>> watchBooths() =>
      (select(
        syncMeta,
      )..where((t) => t.key.equals('assignments'))).watchSingleOrNull().map(
        (row) => row == null
            ? const []
            : [
                for (final a in jsonDecode(row.value) as List<dynamic>)
                  BoothAssignment.fromJson(a as Map<String, dynamic>),
              ],
      );
}

/// A booth the volunteer is assigned to.
class BoothAssignment {
  const BoothAssignment({required this.name, required this.code});

  factory BoothAssignment.fromJson(Map<String, dynamic> json) =>
      BoothAssignment(
        name: json['name'] as String,
        code: json['code'] as String,
      );

  final String name;
  final String code;

  Map<String, String> toJson() => {'name': name, 'code': code};
}
