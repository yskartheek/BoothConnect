import 'package:drift/drift.dart';

import 'tables.dart';

part 'app_database.g.dart';

/// One schema change: from version `n - 1` to `n`.
typedef MigrationStep = Future<void> Function(Migrator m);

/// The phone's database. [LocalStore] opens it encrypted.
///
/// **Schema changes.** Bump [schemaVersion] and add a step for the new
/// version to [migrationSteps]; never edit a released step. Cached server
/// data (households, voters, field values, visits) may be dropped and
/// re-pulled by clearing the `cursor` in `sync_meta`. The `pending_mutation`
/// rows are changes not yet on the server: migrate them in place, never
/// drop them.
@DriftDatabase(
  tables: [
    FieldDefinitions,
    Households,
    Voters,
    FieldValues,
    Visits,
    SyncMeta,
    PendingMutations,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.e);

  @override
  int get schemaVersion => 2;

  /// Steps by the version they lead to. Version 1 is created, not migrated.
  static final Map<int, MigrationStep> migrationSteps = {
    // #63: which household a queued change is about.
    2: (m) async {
      final db = m.database as AppDatabase;
      await m.addColumn(db.pendingMutations, db.pendingMutations.householdId);
      await m.create(db.pendingMutationHousehold);
    },
  };

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) => runMigrationSteps(m, from, to, migrationSteps),
    beforeOpen: (details) => customStatement('PRAGMA foreign_keys = ON'),
  );
}

/// Runs the steps from [from] to [to] in order. A missing step or a
/// downgrade (an older app on a newer database) fails instead of opening a
/// database the code doesn't match.
Future<void> runMigrationSteps(
  Migrator m,
  int from,
  int to,
  Map<int, MigrationStep> steps,
) async {
  if (to < from) {
    throw StateError('Database schema $from is newer than this app ($to)');
  }
  for (var version = from + 1; version <= to; version++) {
    final step = steps[version];
    if (step == null) {
      throw StateError('No migration step to schema version $version');
    }
    await step(m);
  }
}
