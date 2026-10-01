import 'dart:convert';

import 'package:drift/drift.dart';

import 'app_database.dart';
import 'ids.dart';
import 'local_reads.dart';

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
