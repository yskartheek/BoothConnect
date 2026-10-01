import 'dart:convert';

import 'package:drift/drift.dart';

import 'app_database.dart';
import 'ids.dart';

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

  /// One row per household still on the roll, for the households list;
  /// with [householdId], just that household.
  Stream<List<HouseholdSummary>> watchHouseholdSummaries({
    String? householdId,
  }) => customSelect(
    """
SELECT h.id, h.display_address, h.house_key,
  (SELECT COUNT(*) FROM voters v
     WHERE v.household_id = h.id AND v.record_status = 'active') AS members,
  (SELECT group_concat(json_extract(v.official, '\$.name'), char(10))
     FROM voters v
     WHERE v.household_id = h.id AND v.record_status = 'active') AS names,
  (SELECT group_concat(json_extract(fv.value, '\$'), char(10))
     FROM field_values fv JOIN voters v ON v.id = fv.entity_id
     WHERE v.household_id = h.id AND fv.field_key = 'name'
       AND fv.is_current = 1) AS current_names,
  (SELECT vi.outcome FROM visits vi WHERE vi.household_id = h.id
     ORDER BY vi.started_at DESC LIMIT 1) AS last_outcome,
  (SELECT MAX(vi.started_at) FROM visits vi
     WHERE vi.household_id = h.id) AS last_visit_at,
  (SELECT COUNT(*) FROM visits vi
     WHERE vi.household_id = h.id AND vi.server_id IS NULL)
  + (SELECT COUNT(*) FROM pending_mutation pm
     WHERE pm.household_id = h.id AND pm.status != 'conflict') AS on_phone,
  (SELECT COUNT(*) FROM pending_mutation pm
     WHERE pm.household_id = h.id AND pm.status = 'conflict')
  + (SELECT COUNT(*) FROM field_values fv
     WHERE fv.is_current = 1 AND fv.conflict_with_id IS NOT NULL
       AND (fv.entity_id = h.id OR fv.entity_id IN
         (SELECT v.id FROM voters v WHERE v.household_id = h.id)))
    AS conflicts
FROM households h
WHERE h.status != 'removed' AND (?1 IS NULL OR h.id = ?1)
""",
    variables: [Variable<String>(householdId)],
    readsFrom: {households, voters, fieldValues, visits, pendingMutations},
  ).map(HouseholdSummary.fromRow).watch();

  /// A household's active members as their cards show them: the current
  /// value of each detail, else the roll's. In roll order; members added by
  /// volunteers (no serial number) last, by name.
  Stream<List<MemberCard>> watchMemberCards(String householdId) {
    String current(String key) =>
        '(SELECT fv.value FROM field_values fv '
        "WHERE fv.entity_id = v.id AND fv.field_key = '$key' "
        'AND fv.is_current = 1 ORDER BY fv.collected_at DESC LIMIT 1) '
        'AS $key';
    return customSelect(
      'SELECT v.id, v.official, ${current('name')}, ${current('age')}, '
      "${current('gender')}, ${current('occupation')} "
      'FROM voters v '
      "WHERE v.household_id = ?1 AND v.record_status = 'active' "
      'ORDER BY v.serial_no IS NULL, v.section_no, v.serial_no, '
      'name COLLATE NOCASE',
      variables: [Variable<String>(householdId)],
      readsFrom: {voters, fieldValues},
    ).map(MemberCard.fromRow).watch();
  }

  /// The member details changed on this phone since [since] and not yet
  /// uploaded, by member: for "Updated mobile, occupation" in a visit.
  Stream<Map<String, List<String>>> watchMemberChangesSince(
    String householdId,
    DateTime since,
  ) =>
      customSelect(
        r"SELECT json_extract(payload, '$.entityId') AS member, "
        r"json_extract(payload, '$.fieldKey') AS field "
        "FROM pending_mutation WHERE type = 'field.change' "
        'AND household_id = ?1 '
        r"AND json_extract(payload, '$.entityType') = 'voter' "
        r"AND json_extract(payload, '$.collectedAt') >= ?2 "
        'ORDER BY id',
        variables: [
          Variable<String>(householdId),
          Variable<String>(isoMillis(since)),
        ],
        readsFrom: {pendingMutations},
      ).watch().map((rows) {
        final changes = <String, List<String>>{};
        for (final row in rows) {
          final fields = changes.putIfAbsent(
            row.read<String>('member'),
            () => [],
          );
          final field = row.read<String>('field');
          if (!fields.contains(field)) fields.add(field);
        }
        return changes;
      });

  /// Details two people changed at once, waiting for the volunteer to choose
  /// which value to keep: each current value marked `conflict_with_id`, with
  /// the value it conflicts with. Newest first.
  Stream<List<OpenConflict>> watchOpenConflicts() {
    const value = 'id, value, collected_by_id, collected_by_name, collected_at';
    String columns(String t, String p) =>
        value.split(', ').map((c) => '$t.$c AS ${p}_$c').join(', ');
    return customSelect(
      'SELECT a.entity_type, a.entity_id, a.field_key, '
      '${columns('a', 'mine')}, ${columns('b', 'other')}, '
      'h.id AS household_id, h.display_address, '
      '(SELECT n.value FROM field_values n WHERE n.entity_id = v.id '
      "AND n.field_key = 'name' AND n.is_current = 1 "
      'ORDER BY n.collected_at DESC LIMIT 1) AS current_name, '
      'v.official '
      'FROM field_values a '
      'JOIN field_values b ON b.id = a.conflict_with_id '
      "LEFT JOIN voters v ON a.entity_type = 'voter' AND v.id = a.entity_id "
      'LEFT JOIN households h ON h.id = COALESCE(v.household_id, a.entity_id) '
      'WHERE a.is_current = 1 AND a.conflict_with_id IS NOT NULL '
      'ORDER BY a.collected_at DESC',
      readsFrom: {fieldValues, voters, households},
    ).map(OpenConflict.fromRow).watch();
  }

  /// Changes waiting to upload (not those waiting for a choice), oldest
  /// first, with the household's address.
  Stream<List<UploadItem>> watchUploadQueue() => customSelect(
    'SELECT m.id, m.type, m.status, m.attempts, m.next_attempt_at, '
    'm.last_error, m.payload, h.display_address '
    'FROM pending_mutation m LEFT JOIN households h ON h.id = m.household_id '
    "WHERE m.status != 'conflict' ORDER BY m.id",
    readsFrom: {pendingMutations, households},
  ).map(UploadItem.fromRow).watch();

  /// The signed-in volunteer's id (`sync_meta.owner`).
  Stream<String?> watchOwner() =>
      (select(syncMeta)..where((t) => t.key.equals('owner')))
          .watchSingleOrNull()
          .map((row) => row?.value);

  /// One member for the details screen: the roll's record, each detail's
  /// current value (the latest), and whether a restricted detail (caste /
  /// community) is waiting to upload. Null when the member isn't on the
  /// phone.
  Stream<MemberDetail?> watchMemberDetail(String id) =>
      // Read again whenever any of the three tables changes.
      customSelect(
        'SELECT 1',
        readsFrom: {voters, fieldValues, pendingMutations},
      ).watch().asyncMap((_) => _memberDetail(id));

  Future<MemberDetail?> _memberDetail(String id) async {
    final voter = await (select(
      voters,
    )..where((t) => t.id.equals(id))).getSingleOrNull();
    if (voter == null) return null;
    final rows =
        await (select(fieldValues)
              ..where((t) => t.entityId.equals(id) & t.isCurrent.equals(true))
              ..orderBy([(t) => OrderingTerm(expression: t.collectedAt)]))
            .get();
    final waiting = await customSelect(
      r"SELECT json_extract(payload, '$.fieldKey') AS field "
      "FROM pending_mutation WHERE type = 'field.change' "
      r"AND json_extract(payload, '$.entityId') = ?1 "
      r"AND json_extract(payload, '$.consentId') IS NOT NULL",
      variables: [Variable<String>(id)],
    ).map((row) => row.read<String>('field')).get();
    return MemberDetail(
      voter: voter,
      // The latest current value of each field wins.
      current: {for (final r in rows) r.fieldKey: r},
      waitingRestricted: waiting.toSet(),
    );
  }

  /// The fields collected, by key.
  Stream<Map<String, FieldDefinitionRow>> watchFieldDefinitions() =>
      select(fieldDefinitions)
          .watch()
          .map((rows) => {for (final r in rows) r.key: r});

  /// Keys of fields no longer collected: never shown, nor their values.
  Stream<Set<String>> watchDisabledFieldKeys() =>
      (select(fieldDefinitions)..where((t) => t.enabled.not()))
          .map((row) => row.key)
          .watch()
          .map((keys) => keys.toSet());
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

/// A household as the list shows it.
class HouseholdSummary {
  const HouseholdSummary({
    required this.id,
    required this.address,
    required this.houseKey,
    required this.members,
    this.memberNames = const [],
    this.lastOutcome,
    this.onPhone = 0,
    this.conflicts = 0,
    this.lastVisitAt,
  });

  factory HouseholdSummary.fromRow(QueryRow row) {
    List<String> lines(String column) =>
        (row.readNullable<String>(column) ?? '')
            .split('\n')
            .where((s) => s.isNotEmpty)
            .toList();
    return HouseholdSummary(
      id: row.read<String>('id'),
      address: row.read<String>('display_address'),
      houseKey: row.read<String>('house_key'),
      members: row.read<int>('members'),
      memberNames: [...lines('names'), ...lines('current_names')],
      lastOutcome: row.readNullable<String>('last_outcome'),
      onPhone: row.read<int>('on_phone'),
      conflicts: row.read<int>('conflicts'),
      lastVisitAt: row.readNullable<DateTime>('last_visit_at'),
    );
  }

  final String id;
  final String address;
  final String houseKey;
  final int members;

  /// Names on the roll and as corrected, for search.
  final List<String> memberNames;

  /// The latest visit's outcome (API code), or null when never visited.
  final String? lastOutcome;

  /// When the latest visit started.
  final DateTime? lastVisitAt;

  /// Visits and changes on the phone, not yet uploaded.
  final int onPhone;

  /// Details someone else changed too: the volunteer chooses which to keep.
  final int conflicts;

  VisitStatus get visitStatus => switch (lastOutcome) {
    null => VisitStatus.notVisited,
    'follow_up_requested' => VisitStatus.followUp,
    _ => VisitStatus.visited,
  };

  /// The chip: a conflict first, then anything on the phone, then uploaded
  /// (for a household that has been visited); none for one not visited.
  HouseholdSync? get sync {
    if (conflicts > 0) return HouseholdSync.chooseValue;
    if (onPhone > 0) return HouseholdSync.onPhone;
    if (lastOutcome != null) return HouseholdSync.uploaded;
    return null;
  }

  /// [query] is in the address or a member's name (any case).
  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return address.toLowerCase().contains(q) ||
        memberNames.any((n) => n.toLowerCase().contains(q));
  }
}

enum VisitStatus { notVisited, visited, followUp }

enum HouseholdSync { uploaded, onPhone, chooseValue }

/// House numbers in the order people count them: 2 before 12/4 before 15A.
int compareHouseKeys(String a, String b) {
  final pattern = RegExp(r'(\d+)|(\D+)');
  final pa = pattern.allMatches(a.toLowerCase()).toList();
  final pb = pattern.allMatches(b.toLowerCase()).toList();
  for (var i = 0; i < pa.length && i < pb.length; i++) {
    final x = pa[i].group(0)!, y = pb[i].group(0)!;
    final nx = int.tryParse(x), ny = int.tryParse(y);
    final c = nx != null && ny != null ? nx.compareTo(ny) : x.compareTo(y);
    if (c != 0) return c;
  }
  return pa.length.compareTo(pb.length);
}

/// A member as the household screen's card shows them.
class MemberCard {
  const MemberCard({
    required this.id,
    required this.name,
    this.age,
    this.gender,
    this.occupation,
  });

  factory MemberCard.fromRow(QueryRow row) {
    final official = _decode(row.read<String>('official'));
    final roll = official is Map<String, dynamic>
        ? official
        : const <String, dynamic>{};
    Object? value(String key) {
      final current = row.readNullable<String>(key);
      return current != null ? _decode(current) : roll[key];
    }

    // Anything unexpected (a wrong type, blank) is left out, not shown.
    String? text(String key) {
      final v = value(key);
      return v is String && v.trim().isNotEmpty ? v.trim() : null;
    }

    final age = value('age');
    return MemberCard(
      id: row.read<String>('id'),
      name: text('name') ?? '',
      age: age is num ? age.toInt() : null,
      gender: text('gender'),
      occupation: text('occupation'),
    );
  }

  final String id;
  final String name;
  final int? age;

  /// API code: `female`, `male` or `third_gender`.
  final String? gender;
  final String? occupation;

  /// Up to two initials: "Lakshmi Rao" → "LR".
  String get initials {
    final words = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
    return words
        .take(2)
        .map((w) => String.fromCharCode(w.runes.first).toUpperCase())
        .join();
  }

  static Object? _decode(String json) {
    try {
      return jsonDecode(json);
    } on FormatException {
      return null;
    }
  }
}

/// One value of a conflict: what it is, who set it and when.
class ConflictValue {
  const ConflictValue({
    required this.id,
    required this.value,
    required this.collectedAt,
    this.collectedById,
    this.collectedByName,
  });

  final String id;

  /// Decoded JSON.
  final Object? value;
  final DateTime collectedAt;
  final String? collectedById;
  final String? collectedByName;
}

/// A detail two people changed at once.
class OpenConflict {
  const OpenConflict({
    required this.entityType,
    required this.entityId,
    required this.fieldKey,
    required this.mine,
    required this.other,
    this.householdId,
    this.address,
    this.memberName,
  });

  factory OpenConflict.fromRow(QueryRow row) {
    ConflictValue value(String p) => ConflictValue(
      id: row.read<String>('${p}_id'),
      value: _decodeOrNull(row.read<String>('${p}_value')),
      collectedAt: row.read<DateTime>('${p}_collected_at'),
      collectedById: row.readNullable<String>('${p}_collected_by_id'),
      collectedByName: row.readNullable<String>('${p}_collected_by_name'),
    );
    final official = _decodeOrNull(row.readNullable<String>('official'));
    final current = _decodeOrNull(row.readNullable<String>('current_name'));
    final name = current is String
        ? current
        : official is Map<String, dynamic> && official['name'] is String
        ? official['name'] as String
        : null;
    return OpenConflict(
      entityType: row.read<String>('entity_type'),
      entityId: row.read<String>('entity_id'),
      fieldKey: row.read<String>('field_key'),
      mine: value('mine'),
      other: value('other'),
      householdId: row.readNullable<String>('household_id'),
      address: row.readNullable<String>('display_address'),
      memberName: name,
    );
  }

  final String entityType;
  final String entityId;
  final String fieldKey;

  /// The value marked as conflicting (the newer one).
  final ConflictValue mine;

  /// The value it conflicts with.
  final ConflictValue other;
  final String? householdId;
  final String? address;

  /// For a member's detail.
  final String? memberName;

  /// Both values, newest first.
  List<ConflictValue> get values => other.collectedAt.isAfter(mine.collectedAt)
      ? [other, mine]
      : [mine, other];
}

/// A change waiting in the upload queue.
class UploadItem {
  const UploadItem({
    required this.id,
    required this.type,
    required this.status,
    required this.attempts,
    this.nextAttemptAt,
    this.lastError,
    this.address,
    this.fieldKey,
  });

  factory UploadItem.fromRow(QueryRow row) {
    final payload = _decodeOrNull(row.read<String>('payload'));
    return UploadItem(
      id: row.read<int>('id'),
      type: row.read<String>('type'),
      status: row.read<String>('status'),
      attempts: row.read<int>('attempts'),
      nextAttemptAt: row.readNullable<DateTime>('next_attempt_at'),
      lastError: row.readNullable<String>('last_error'),
      address: row.readNullable<String>('display_address'),
      fieldKey: payload is Map<String, dynamic> && payload['fieldKey'] is String
          ? payload['fieldKey'] as String
          : null,
    );
  }

  final int id;

  /// `visit.create`, `field.change`, …
  final String type;

  /// `pending`, `syncing` or `failed`.
  final String status;
  final int attempts;
  final DateTime? nextAttemptAt;

  /// The API's error code, for a change that wasn't uploaded.
  final String? lastError;
  final String? address;

  /// For `field.change`.
  final String? fieldKey;
}

Object? _decodeOrNull(String? json) {
  if (json == null) return null;
  try {
    return jsonDecode(json);
  } on FormatException {
    return null;
  }
}

/// A member as the details screen edits them.
class MemberDetail {
  const MemberDetail({
    required this.voter,
    required this.current,
    this.waitingRestricted = const {},
  });

  final VoterRow voter;

  /// The current value of each detail, by field key.
  final Map<String, FieldValueRow> current;

  /// Restricted details (with a consent) waiting to upload.
  final Set<String> waitingRestricted;

  Map<String, dynamic> get _official {
    final o = _decodeOrNull(voter.official);
    return o is Map<String, dynamic> ? o : const <String, dynamic>{};
  }

  /// [key]'s value: the current one, else the roll's.
  Object? value(String key) {
    final row = current[key];
    return row != null ? _decodeOrNull(row.value) : _official[key];
  }
}
