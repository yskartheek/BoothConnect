import 'dart:convert';

import 'package:drift/drift.dart';

import '../local/app_database.dart';
import '../local/local_reads.dart';
import 'sync_api.dart';

/// What a pull did.
class PullResult {
  const PullResult({required this.pages, required this.rows});

  final int pages;

  /// Rows written or deleted.
  final int rows;
}

/// Downloads the volunteer's booths into the phone's database.
///
/// Each page is applied in one transaction together with the cursor that
/// follows it, so an interrupted pull (offline, app closed) resumes at the
/// next page and never leaves half a page behind.
class SyncRepository {
  SyncRepository(this._db, this._api);

  /// `sync_meta` keys.
  static const cursorKey = 'cursor';
  static const snapshotKey = 'snapshot_in_progress';
  static const ownerKey = 'owner';
  static const lastPullKey = 'last_pull_at';
  static const assignmentsKey = 'assignments';

  /// A runaway loop guard: far more pages than any booth has.
  static const maxPages = 1000;

  final AppDatabase _db;
  final SyncApi _api;

  /// Pulls until the API has nothing more.
  Future<PullResult> pull({DateTime Function() now = DateTime.now}) async {
    var pages = 0;
    var rows = 0;
    while (true) {
      final page = await _api.pull(since: await _meta(cursorKey));
      rows += await _db.transaction(() => _apply(page));
      pages++;
      if (page['hasMore'] != true) break;
      if (pages >= maxPages) {
        throw StateError('Sync pull did not finish after $maxPages pages');
      }
    }
    await _setMeta(lastPullKey, now().toUtc().toIso8601String());
    return PullResult(pages: pages, rows: rows);
  }

  /// When the last pull finished, or null.
  Future<DateTime?> lastPullAt() async {
    final value = await _meta(lastPullKey);
    return value == null ? null : DateTime.parse(value);
  }

  /// The user whose data this database holds, or null when it is empty.
  Future<String?> owner() => _meta(ownerKey);

  Future<void> setOwner(String userId) => _setMeta(ownerKey, userId);

  /// The volunteer's booths, for the home screen (they come from
  /// `GET /v1/me`, which the pull doesn't repeat).
  Future<void> setBooths(List<BoothAssignment> booths) => _setMeta(
    assignmentsKey,
    jsonEncode([for (final b in booths) b.toJson()]),
  );

  Future<int> _apply(Map<String, dynamic> page) async {
    var rows = 0;
    final reset = page['reset'] == true;
    final hasMore = page['hasMore'] == true;
    if (reset) {
      // Every page of a snapshot says reset. Clear only on its first page;
      // a snapshot interrupted halfway goes on where it stopped.
      if (await _meta(snapshotKey) == null) rows += await _clearCache();
      if (hasMore) {
        await _setMeta(snapshotKey, '1');
      } else {
        await _deleteMeta(snapshotKey);
      }
    }

    final definitions = _list(page, 'fieldDefinitions').map(_definition);
    final households = _list(page, 'households').map(_household);
    final voters = _list(page, 'voters').map(_voter);
    // Open conflicts (last page): both values, so the volunteer can choose,
    // even one this phone had stopped showing as current.
    final values = [
      ..._list(page, 'fieldValues'),
      for (final c in _list(page, 'conflicts'))
        ...(c as Map<String, dynamic>)['values'] as List<dynamic>,
    ].map(_fieldValue);
    final visits = _list(page, 'visits').map(_visit);
    await _db.batch((b) {
      b.insertAllOnConflictUpdate(_db.fieldDefinitions, definitions.toList());
      b.insertAllOnConflictUpdate(_db.households, households.toList());
      b.insertAllOnConflictUpdate(_db.voters, voters.toList());
      b.insertAllOnConflictUpdate(_db.fieldValues, values.toList());
      b.insertAllOnConflictUpdate(_db.visits, visits.toList());
    });
    rows +=
        definitions.length +
        households.length +
        voters.length +
        values.length +
        visits.length;

    // Values whose consent was withdrawn: gone from the phone too.
    final removed = _list(page, 'removedFieldValueIds').cast<String>();
    if (removed.isNotEmpty) {
      rows += await (_db.delete(
        _db.fieldValues,
      )..where((t) => t.id.isIn(removed))).go();
    }

    // Restricted details (caste / community) aren't kept on a volunteer's
    // phone, even if the server sends them: only authorised staff see them.
    await _db.customUpdate(
      'DELETE FROM field_values WHERE field_key IN '
      '(SELECT key FROM field_definitions WHERE is_restricted = 1)',
      updates: {_db.fieldValues},
      updateKind: UpdateKind.delete,
    );

    await _setMeta(cursorKey, page['cursor'] as String);
    return rows;
  }

  /// Drops the cached server data before a full snapshot. Visits recorded
  /// on the phone and not yet uploaded (no server id) stay, as do
  /// households added on the phone and not yet uploaded, the push queue and
  /// the owner.
  Future<int> _clearCache() async {
    var rows = 0;
    rows += await _db.delete(_db.fieldDefinitions).go();
    rows += await _db.customUpdate(
      'DELETE FROM households WHERE id NOT IN (SELECT household_id '
      "FROM pending_mutation WHERE type = 'household.create' "
      'AND household_id IS NOT NULL)',
      updates: {_db.households},
      updateKind: UpdateKind.delete,
    );
    rows += await _db.delete(_db.voters).go();
    rows += await _db.delete(_db.fieldValues).go();
    rows += await (_db.delete(
      _db.visits,
    )..where((t) => t.serverId.isNotNull())).go();
    return rows;
  }

  static List<dynamic> _list(Map<String, dynamic> page, String key) =>
      (page[key] as List<dynamic>?) ?? const [];

  static String? _json(Object? value) =>
      value == null ? null : jsonEncode(value);

  static DateTime? _date(Object? value) =>
      value == null ? null : DateTime.parse(value as String).toUtc();

  static FieldDefinitionsCompanion _definition(dynamic raw) {
    final j = raw as Map<String, dynamic>;
    return FieldDefinitionsCompanion.insert(
      id: j['id'] as String,
      key: j['key'] as String,
      labelKey: j['labelKey'] as String,
      appliesTo: j['appliesTo'] as String,
      type: j['type'] as String,
      options: Value(_json(j['options'])),
      isRestricted: j['isRestricted'] as bool,
      requiresConsent: j['requiresConsent'] as bool,
      enabled: j['enabled'] as bool,
      purpose: j['purpose'] as String,
    );
  }

  static HouseholdsCompanion _household(dynamic raw) {
    final j = raw as Map<String, dynamic>;
    final location = j['location'] as Map<String, dynamic>?;
    return HouseholdsCompanion.insert(
      id: j['id'] as String,
      partId: j['partId'] as String,
      pollingStationId: j['pollingStationId'] as String,
      displayAddress: j['displayAddress'] as String,
      houseKey: j['houseKey'] as String,
      structuredAddress: Value(_json(j['structuredAddress'])),
      latitude: Value((location?['lat'] as num?)?.toDouble()),
      longitude: Value((location?['lng'] as num?)?.toDouble()),
      accuracyM: Value((location?['accuracyM'] as num?)?.toDouble()),
      locationCapturedAt: Value(_date(location?['capturedAt'])),
      origin: j['origin'] as String,
      status: j['status'] as String,
    );
  }

  static VotersCompanion _voter(dynamic raw) {
    final j = raw as Map<String, dynamic>;
    return VotersCompanion.insert(
      id: j['id'] as String,
      householdId: j['householdId'] as String,
      partId: j['partId'] as String,
      pollingStationId: j['pollingStationId'] as String,
      origin: j['origin'] as String,
      recordStatus: j['recordStatus'] as String,
      sectionNo: Value((j['sectionNo'] as num?)?.toInt()),
      serialNo: Value((j['serialNo'] as num?)?.toInt()),
      epicNumber: Value(j['epicNumber'] as String?),
      official: jsonEncode(j['official']),
      previousVoterIds: (j['previousVoterIds'] as List<dynamic>).cast<String>(),
    );
  }

  static FieldValuesCompanion _fieldValue(dynamic raw) {
    final j = raw as Map<String, dynamic>;
    final by = j['collectedBy'] as Map<String, dynamic>?;
    return FieldValuesCompanion.insert(
      id: j['id'] as String,
      entityType: j['entityType'] as String,
      entityId: j['entityId'] as String,
      fieldKey: j['fieldKey'] as String,
      value: jsonEncode(j['value']),
      sourceType: j['sourceType'] as String,
      collectedById: Value(by?['id'] as String?),
      collectedByName: Value(by?['name'] as String?),
      collectedAt: _date(j['collectedAt'])!,
      supersedesId: Value(j['supersedesId'] as String?),
      carriedFromId: Value(j['carriedFromId'] as String?),
      isCurrent: j['isCurrent'] as bool,
      conflictWithId: Value(j['conflictWithId'] as String?),
    );
  }

  static VisitsCompanion _visit(dynamic raw) {
    final j = raw as Map<String, dynamic>;
    return VisitsCompanion.insert(
      clientId: j['clientId'] as String,
      serverId: Value(j['id'] as String),
      householdId: j['householdId'] as String,
      volunteerId: j['volunteerId'] as String,
      startedAt: _date(j['startedAt'])!,
      completedAt: Value(_date(j['completedAt'])),
      outcome: j['outcome'] as String,
      formVersion: j['formVersion'] as String,
      notes: Value(j['notes'] as String?),
      correctsVisitId: Value(j['correctsVisitId'] as String?),
      memberIdsMet: (j['memberIdsMet'] as List<dynamic>).cast<String>(),
    );
  }

  Future<String?> _meta(String key) async {
    final row = await (_db.select(
      _db.syncMeta,
    )..where((t) => t.key.equals(key))).getSingleOrNull();
    return row?.value;
  }

  Future<void> _setMeta(String key, String value) => _db
      .into(_db.syncMeta)
      .insertOnConflictUpdate(SyncMetaCompanion.insert(key: key, value: value));

  Future<void> _deleteMeta(String key) =>
      (_db.delete(_db.syncMeta)..where((t) => t.key.equals(key))).go();
}
