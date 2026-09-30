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
