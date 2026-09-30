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
}
