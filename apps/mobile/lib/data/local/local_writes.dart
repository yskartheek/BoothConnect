import 'dart:convert';

import 'package:drift/drift.dart';

import 'app_database.dart';
import 'ids.dart';
import 'local_reads.dart';

/// The consent notice the volunteer reads out (its version is recorded with
/// each consent).
const consentNoticeVersion = '2026.1';

/// Changes made on the phone. Each is written to the local database and
/// queued in `pending_mutation` in one transaction, so it shows at once,
/// works offline, and is uploaded by the sync worker (#66). Payloads follow
/// the API's `POST /v1/sync/push` types.
extension LocalWrites on AppDatabase {
  /// The signed-in volunteer, saved at sign-in (`sync_meta.owner`).
  Future<String> _owner() async {
    final row = await (select(
      syncMeta,
    )..where((t) => t.key.equals('owner'))).getSingleOrNull();
    if (row == null) throw StateError('No volunteer is signed in');
    return row.value;
  }

  /// Records a visit to [householdId] and queues `visit.create`. Returns the
  /// visit's client id.
  Future<String> recordVisit({
    required String householdId,
    required String outcome,
    required DateTime startedAt,
    required DateTime completedAt,
    List<String> memberIdsMet = const [],
    String? notes,
    String formVersion = '1',
  }) => transaction(() async {
    final volunteerId = await _owner();
    final clientId = newId();
    final note = notes?.trim();
    await into(visits).insert(
      VisitsCompanion.insert(
        clientId: clientId,
        householdId: householdId,
        volunteerId: volunteerId,
        startedAt: startedAt,
        completedAt: Value(completedAt),
        outcome: outcome,
        formVersion: formVersion,
        notes: Value(note == null || note.isEmpty ? null : note),
        memberIdsMet: memberIdsMet,
      ),
    );
    await _queue('visit.create', householdId, completedAt, {
      'clientId': clientId,
      'householdId': householdId,
      'startedAt': isoMillis(startedAt),
      'completedAt': isoMillis(completedAt),
      'outcome': outcome,
      'formVersion': formVersion,
      if (note != null && note.isNotEmpty) 'notes': note,
      'memberIdsMet': memberIdsMet,
    });
    return clientId;
  });

  /// Sets [fieldKey] of a member (`voter`) or household to [value] and
  /// queues `field.change` with the `baseVersion` the phone saw, so the
  /// server can tell whether someone else changed it meanwhile.
  ///
  /// Changing the same field again before it is uploaded updates the
  /// queued change instead: the server gets one change, from the original
  /// base.
  Future<void> changeField({
    required String entityType,
    required String entityId,
    required String householdId,
    required String fieldKey,
    required Object value,
    required DateTime at,
  }) => transaction(() async {
    final json = jsonEncode(value);
    final collectedAt = isoMillis(at);
    final current =
        await (select(fieldValues)
              ..where(
                (t) =>
                    t.entityId.equals(entityId) &
                    t.fieldKey.equals(fieldKey) &
                    t.isCurrent.equals(true),
              )
              ..orderBy([
                (t) => OrderingTerm(
                  expression: t.collectedAt,
                  mode: OrderingMode.desc,
                ),
              ]))
            .get();

    final queued = await customSelect(
      "SELECT id, payload FROM pending_mutation WHERE type = 'field.change' "
      // Never sent: once sent, the server may have stored it under its key,
      // and the same key can't carry another value.
      "AND status = 'pending' AND attempts = 0 "
      r"AND json_extract(payload, '$.entityId') = ?1 "
      r"AND json_extract(payload, '$.fieldKey') = ?2 "
      'ORDER BY id DESC LIMIT 1',
      variables: [Variable<String>(entityId), Variable<String>(fieldKey)],
      readsFrom: {pendingMutations},
    ).getSingleOrNull();
    if (queued != null && current.isNotEmpty) {
      final payload =
          jsonDecode(queued.read<String>('payload')) as Map<String, dynamic>
            ..['value'] = value
            ..['collectedAt'] = collectedAt;
      await (update(
        pendingMutations,
      )..where((t) => t.id.equals(queued.read<int>('id')))).write(
        PendingMutationsCompanion(payload: Value(jsonEncode(payload))),
      );
      await (update(
        fieldValues,
      )..where((t) => t.id.equals(current.first.id))).write(
        FieldValuesCompanion(value: Value(json), collectedAt: Value(at)),
      );
      return;
    }

    final base = current.firstOrNull?.id;
    await (update(fieldValues)..where(
          (t) =>
              t.entityId.equals(entityId) &
              t.fieldKey.equals(fieldKey) &
              t.isCurrent.equals(true),
        ))
        .write(const FieldValuesCompanion(isCurrent: Value(false)));
    final localId = newId();
    await into(fieldValues).insert(
      FieldValuesCompanion.insert(
        id: localId,
        entityType: entityType,
        entityId: entityId,
        fieldKey: fieldKey,
        value: json,
        sourceType: 'volunteer_collected',
        collectedById: Value(await _owner()),
        collectedAt: at,
        supersedesId: Value(base),
        isCurrent: true,
      ),
    );
    await _queue('field.change', householdId, at, {
      'entityType': entityType,
      'entityId': entityId,
      'fieldKey': fieldKey,
      'value': value,
      'baseVersion': base,
      'collectedAt': collectedAt,
      // The phone's copy, given the server's id once uploaded. Keys starting
      // with "_" stay on the phone.
      '_fieldValueId': localId,
    });
  });

  /// Records the member's agreement to share [purpose] (a field key, e.g.
  /// `caste_community`) and queues `consent.capture`. Returns its id, which
  /// the values it covers name as `consentId`.
  Future<String> captureConsent({
    required String voterId,
    required String householdId,
    required String purpose,
    required DateTime at,
    String noticeVersion = consentNoticeVersion,
  }) async {
    final id = newId();
    await _queue('consent.capture', householdId, at, {
      'id': id,
      'voterId': voterId,
      'purpose': purpose,
      'noticeVersion': noticeVersion,
      'method': 'in_person_verbal',
      'capturedAt': isoMillis(at),
    });
    return id;
  }

  /// Queues a restricted detail (caste / community) for upload without
  /// keeping it on the phone: once uploaded, only authorised staff see it.
  /// The phone never holds the current value, so there is no base.
  Future<void> queueRestrictedField({
    required String voterId,
    required String householdId,
    required String fieldKey,
    required Object value,
    required String consentId,
    required DateTime at,
  }) => _queue('field.change', householdId, at, {
    'entityType': 'voter',
    'entityId': voterId,
    'fieldKey': fieldKey,
    'value': value,
    'baseVersion': null,
    'consentId': consentId,
    'collectedAt': isoMillis(at),
  });

  /// Adds someone who lives in [householdId] but isn't on the official list,
  /// and queues `member.create`. [fields] are other details (mobile number,
  /// occupation, …). Returns the member's id, made on the phone.
  Future<String> addMember({
    required String householdId,
    required String name,
    int? age,
    String? gender,
    Map<String, Object> fields = const {},
    required DateTime at,
  }) => transaction(() async {
    final household = await (select(
      households,
    )..where((t) => t.id.equals(householdId))).getSingle();
    final owner = await _owner();
    final id = newId();
    await into(voters).insert(
      VotersCompanion.insert(
        id: id,
        householdId: householdId,
        partId: household.partId,
        pollingStationId: household.pollingStationId,
        origin: 'volunteer_added',
        recordStatus: 'active',
        official: 'null',
        previousVoterIds: const [],
      ),
    );
    final values = <String, Object>{
      'name': name,
      'age': ?age,
      'gender': ?gender,
      ...fields,
    };
    final localIds = <String, String>{};
    for (final MapEntry(:key, :value) in values.entries) {
      final valueId = localIds[key] = newId();
      await into(fieldValues).insert(
        FieldValuesCompanion.insert(
          id: valueId,
          entityType: 'voter',
          entityId: id,
          fieldKey: key,
          value: jsonEncode(value),
          sourceType: 'volunteer_collected',
          collectedById: Value(owner),
          collectedAt: at,
          isCurrent: true,
        ),
      );
    }
    await _queue('member.create', householdId, at, {
      'householdId': householdId,
      'id': id,
      'name': name,
      'age': ?age,
      'gender': ?gender,
      'fields': [
        for (final MapEntry(:key, :value) in fields.entries)
          {'fieldKey': key, 'value': value},
      ],
      // The phone's copies, given the server's ids once uploaded.
      '_fieldValueIds': localIds,
    });
    return id;
  });

  /// Adds a household that isn't on the official list, in booth
  /// [pollingStationId], and queues `household.create` with an id made on
  /// the phone. Returns it.
  ///
  /// Throws [HouseNumberTaken] when a household in the same part already
  /// has [address]'s house number: the server would refuse it.
  Future<String> addHousehold({
    required String pollingStationId,
    required Map<String, String> address,
    HouseholdLocation? location,
    required DateTime at,
  }) => transaction(() async {
    final clean = cleanAddress(address);
    final neighbour =
        await (select(households)
              ..where((t) => t.pollingStationId.equals(pollingStationId))
              ..limit(1))
            .getSingleOrNull();
    if (neighbour == null) {
      throw StateError(
        'No household of booth $pollingStationId is on the phone',
      );
    }
    final houseNo = clean['house_no'];
    if (houseNo != null) {
      final taken =
          await (select(households)..where(
                (t) =>
                    t.partId.equals(neighbour.partId) &
                    t.houseKey.equals(houseNo),
              ))
              .get();
      if (taken.isNotEmpty) throw const HouseNumberTaken();
    }
    final id = newId();
    await into(households).insert(
      HouseholdsCompanion.insert(
        id: id,
        partId: neighbour.partId,
        pollingStationId: pollingStationId,
        displayAddress: displayAddress(clean),
        // As the server makes it.
        houseKey: houseNo ?? '~$id',
        structuredAddress: Value(jsonEncode(clean)),
        latitude: Value(location?.lat),
        longitude: Value(location?.lng),
        accuracyM: Value(location?.accuracyM),
        locationCapturedAt: Value(location?.capturedAt),
        origin: 'volunteer_added',
        status: 'active',
      ),
    );
    await _queue('household.create', id, at, {
      'id': id,
      'pollingStationId': pollingStationId,
      'address': clean,
      if (location != null) 'location': location.toPayload(),
    });
    return id;
  });

  /// Saves a household's [address] and/or a new [location] reading on the
  /// phone and queues `household.update`, with the values the phone saw as
  /// bases (as for [changeField]). A location goes with the household's
  /// consent to store it.
  ///
  /// A household added on the phone and not sent yet has its queued
  /// `household.create` updated instead.
  Future<void> updateHousehold({
    required String householdId,
    Map<String, String>? address,
    HouseholdLocation? location,
    required DateTime at,
  }) => transaction(() async {
    if (address == null && location == null) return;
    final clean = address == null ? null : cleanAddress(address);
    await (update(households)..where((t) => t.id.equals(householdId))).write(
      HouseholdsCompanion(
        displayAddress: clean == null
            ? const Value.absent()
            : Value(displayAddress(clean)),
        structuredAddress: clean == null
            ? const Value.absent()
            : Value(jsonEncode(clean)),
        latitude: location == null ? const Value.absent() : Value(location.lat),
        longitude: location == null
            ? const Value.absent()
            : Value(location.lng),
        accuracyM: location == null
            ? const Value.absent()
            : Value(location.accuracyM),
        locationCapturedAt: location == null
            ? const Value.absent()
            : Value(location.capturedAt),
      ),
    );

    final created = await customSelect(
      "SELECT id, payload FROM pending_mutation WHERE type = 'household.create' "
      "AND status = 'pending' AND attempts = 0 "
      r"AND json_extract(payload, '$.id') = ?1 LIMIT 1",
      variables: [Variable<String>(householdId)],
      readsFrom: {pendingMutations},
    ).getSingleOrNull();
    if (created != null) {
      final payload =
          jsonDecode(created.read<String>('payload')) as Map<String, dynamic>;
      if (clean != null) payload['address'] = clean;
      if (location != null) payload['location'] = location.toPayload();
      await (update(
        pendingMutations,
      )..where((t) => t.id.equals(created.read<int>('id')))).write(
        PendingMutationsCompanion(payload: Value(jsonEncode(payload))),
      );
      return;
    }

    final owner = await _owner();
    final payload = <String, Object?>{'id': householdId};
    final localIds = <String, String>{};
    Future<void> value(String key, Object json, DateTime collectedAt) async {
      final current =
          await (select(fieldValues)
                ..where(
                  (t) =>
                      t.entityId.equals(householdId) &
                      t.fieldKey.equals(key) &
                      t.isCurrent.equals(true),
                )
                ..orderBy([
                  (t) => OrderingTerm(
                    expression: t.collectedAt,
                    mode: OrderingMode.desc,
                  ),
                ]))
              .get();
      await (update(fieldValues)..where(
            (t) =>
                t.entityId.equals(householdId) &
                t.fieldKey.equals(key) &
                t.isCurrent.equals(true),
          ))
          .write(const FieldValuesCompanion(isCurrent: Value(false)));
      final localId = localIds[key] = newId();
      await into(fieldValues).insert(
        FieldValuesCompanion.insert(
          id: localId,
          entityType: 'household',
          entityId: householdId,
          fieldKey: key,
          value: jsonEncode(json),
          sourceType: 'volunteer_collected',
          collectedById: Value(owner),
          collectedAt: collectedAt,
          supersedesId: Value(current.firstOrNull?.id),
          isCurrent: true,
        ),
      );
      payload[key == addressKey
              ? 'addressBaseVersion'
              : 'locationBaseVersion'] =
          current.firstOrNull?.id;
    }

    if (clean != null) {
      await value(addressKey, clean, at);
      payload['address'] = clean;
    }
    if (location != null) {
      final reading = location.toPayload()..remove('consent');
      await value(locationKey, reading, location.capturedAt);
      payload['location'] = location.toPayload();
    }
    // The phone's copies, given the server's ids once uploaded.
    payload['_fieldValueIds'] = localIds;
    await _queue('household.update', householdId, at, payload);
  });

  /// Keeps [keepId], one of [conflict]'s two values, and queues
  /// `conflict.resolve`. The other value stays in the history (no longer
  /// current), and the change that ended in this conflict leaves the
  /// queue: the server already has it.
  Future<void> resolveConflict(OpenConflict conflict, String keepId) =>
      transaction(() async {
        final ids = [conflict.mine.id, conflict.other.id];
        if (!ids.contains(keepId)) {
          throw ArgumentError.value(keepId, 'keepId', 'not in the conflict');
        }
        await (update(fieldValues)..where((t) => t.id.isIn(ids))).write(
          const FieldValuesCompanion(
            isCurrent: Value(false),
            conflictWithId: Value(null),
          ),
        );
        await (update(fieldValues)..where((t) => t.id.equals(keepId))).write(
          const FieldValuesCompanion(isCurrent: Value(true)),
        );
        await customUpdate(
          "DELETE FROM pending_mutation WHERE status = 'conflict' "
          "AND type = 'field.change' "
          r"AND json_extract(payload, '$.entityId') = ?1 "
          r"AND json_extract(payload, '$.fieldKey') = ?2",
          variables: [
            Variable<String>(conflict.entityId),
            Variable<String>(conflict.fieldKey),
          ],
          updates: {pendingMutations},
          updateKind: UpdateKind.delete,
        );
        // An address or location: the household change it came with.
        await customUpdate(
          "DELETE FROM pending_mutation WHERE status = 'conflict' "
          "AND type = 'household.update' "
          r"AND json_extract(payload, '$.id') = ?1",
          variables: [Variable<String>(conflict.entityId)],
          updates: {pendingMutations},
          updateKind: UpdateKind.delete,
        );
        await _queue(
          'conflict.resolve',
          conflict.householdId ?? conflict.entityId,
          DateTime.now(),
          {'conflictId': conflict.mine.id, 'keepFieldValueId': keepId},
        );
      });

  Future<void> _queue(
    String type,
    String householdId,
    DateTime at,
    Map<String, Object?> payload,
  ) => into(pendingMutations).insert(
    PendingMutationsCompanion.insert(
      key: newId(),
      type: type,
      householdId: Value(householdId),
      payload: jsonEncode(payload),
      createdAt: at,
    ),
  );
}

/// A household's address, as the API's `address` field holds it.
const addressKey = 'address';

/// A household's location, taken with its consent.
const locationKey = 'household_location';

/// The address parts, trimmed; empty ones left out (as the server keeps
/// them).
Map<String, String> cleanAddress(Map<String, String> address) => {
  for (final MapEntry(:key, :value) in address.entries)
    if (value.trim().isNotEmpty) key: value.trim(),
};

/// "12/4, Gandhi Road, Nehru Nagar, 500038", as the server writes it.
String displayAddress(Map<String, String> address) => [
  for (final key in const ['house_no', 'street', 'area', 'pin_code'])
    ?address[key],
].join(', ');

/// One reading from the phone, taken when the volunteer tapped the button,
/// with the household's agreement to store it.
class HouseholdLocation {
  const HouseholdLocation({
    required this.lat,
    required this.lng,
    this.accuracyM,
    required this.capturedAt,
    this.noticeVersion = consentNoticeVersion,
  });

  final double lat;
  final double lng;
  final double? accuracyM;
  final DateTime capturedAt;

  /// Of the notice read out before the household agreed.
  final String noticeVersion;

  Map<String, Object> toPayload() => {
    'lat': lat,
    'lng': lng,
    'accuracyM': ?accuracyM,
    'capturedAt': isoMillis(capturedAt),
    'consent': {'noticeVersion': noticeVersion, 'method': 'in_person_verbal'},
  };
}

/// Another household in the same part already has this house number.
class HouseNumberTaken implements Exception {
  const HouseNumberTaken();
}
