import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:drift/drift.dart';

import '../api/api_error.dart';
import '../local/app_database.dart';
import 'sync_api.dart';

/// What a push did.
class PushResult {
  const PushResult({
    this.uploaded = 0,
    this.conflicts = 0,
    this.failed = 0,
    this.error,
  });

  /// Stored on the server (applied, or already there: duplicate).
  final int uploaded;

  /// Stored, but someone else changed the same detail: the volunteer
  /// chooses which value to keep.
  final int conflicts;

  /// Refused by the server: kept on the phone, with the reason.
  final int failed;

  /// Why the push stopped early (offline, server error); the changes it
  /// couldn't send wait for their next attempt.
  final ApiError? error;
}

/// The wait before retry number [attempts] (1, 2, …): doubling from 2
/// seconds, at most 5 minutes, with jitter so phones that lost the
/// network together don't all retry at once. Between half and all of the
/// doubled delay.
Duration backoff(int attempts, [Random? random]) {
  final exponent = min(max(attempts, 1) - 1, 20);
  final ceiling = min(
    PushRepository.firstRetry.inMilliseconds * pow(2, exponent),
    PushRepository.maxRetry.inMilliseconds,
  ).toInt();
  final jitter = (random ?? Random()).nextDouble();
  return Duration(milliseconds: (ceiling * (0.5 + jitter / 2)).round());
}

/// The request's `Idempotency-Key`: a hash of exactly what is sent. The
/// same batch sent again (the answer was lost) gets the same key, and the
/// server replays its answer; any other batch gets another key.
String batchKey(List<Map<String, Object?>> batch) =>
    'push-${sha256.convert(utf8.encode(jsonEncode(batch)))}';

/// Uploads the changes queued in `pending_mutation` to
/// `POST /v1/sync/push`, oldest first, in batches.
///
/// Each change keeps its idempotency key for every attempt: sent twice, the
/// server stores it once (`duplicate`). Only one push may run at a time
/// (`SyncController` holds the lock).
class PushRepository {
  PushRepository(this._db, this._api, {Random? random})
    : _random = random ?? Random();

  static const batchSize = 50;
  static const firstRetry = Duration(seconds: 2);
  static const maxRetry = Duration(minutes: 5);

  final AppDatabase _db;
  final SyncApi _api;
  final Random _random;

  /// Sends every change that is due, batch after batch, until none is due
  /// or the server can't be reached.
  Future<PushResult> pushDue({DateTime Function() now = DateTime.now}) async {
    // Left `syncing` by a push the app didn't finish (closed, killed): the
    // server may or may not have them. Resent with the same keys, they're
    // stored once.
    await (_db.update(_db.pendingMutations)
          ..where((t) => t.status.equals('syncing')))
        .write(const PendingMutationsCompanion(status: Value('pending')));

    var uploaded = 0, conflicts = 0, failed = 0;
    while (true) {
      final due = await _takeDue(now());
      if (due.isEmpty) break;
      final List<Map<String, dynamic>> results;
      try {
        final batch = [
          for (final m in due)
            {'key': m.key, 'type': m.type, 'payload': _toSend(m.payload)},
        ];
        results = await _api.push(batch, idempotencyKey: batchKey(batch));
      } on ApiError catch (e) {
        await _retryLater(due, now(), e.code);
        return PushResult(
          uploaded: uploaded,
          conflicts: conflicts,
          failed: failed,
          error: e,
        );
      }

      final byKey = {for (final r in results) r['key'] as String: r};
      await _db.transaction(() async {
        for (final mutation in due) {
          final result = byKey[mutation.key];
          switch (result?['status']) {
            case 'applied' || 'duplicate':
              await _reconcile(mutation, result!);
              await (_db.delete(
                _db.pendingMutations,
              )..where((t) => t.id.equals(mutation.id))).go();
              uploaded++;
            case 'conflict':
              await _reconcile(mutation, result!);
              await _setStatus(mutation, 'conflict', 'CONFLICT');
              conflicts++;
            case 'rejected':
              await _setStatus(
                mutation,
                'failed',
                result!['code'] as String? ?? ApiError.unexpected,
              );
              failed++;
            default:
              // No answer for this one: try it again later.
              await _retryLater([mutation], now(), ApiError.unexpected);
          }
        }
      });
    }
    return PushResult(uploaded: uploaded, conflicts: conflicts, failed: failed);
  }

  /// Retry now: changes the server refused (after, say, a fix on the
  /// server) and changes waiting for their next attempt.
  Future<int> retryNow() =>
      (_db.update(
        _db.pendingMutations,
      )..where((t) => t.status.isIn(['pending', 'failed']))).write(
        const PendingMutationsCompanion(
          status: Value('pending'),
          nextAttemptAt: Value(null),
        ),
      );

  /// Every change waiting for its next try is due now (not those the
  /// server refused): the phone is back online, so the wait is over.
  Future<int> dueNow() =>
      (_db.update(_db.pendingMutations)
            ..where((t) => t.status.equals('pending')))
          .write(const PendingMutationsCompanion(nextAttemptAt: Value(null)));

  /// Retry one change now (per-item retry).
  Future<void> retryOne(int id) =>
      (_db.update(_db.pendingMutations)..where(
            (t) => t.id.equals(id) & t.status.isIn(['pending', 'failed']),
          ))
          .write(
            const PendingMutationsCompanion(
              status: Value('pending'),
              nextAttemptAt: Value(null),
            ),
          );

  /// When the next change waiting to retry is due, or null if none waits.
  Future<DateTime?> nextAttemptAt() async {
    final next = _db.pendingMutations.nextAttemptAt.min();
    final row =
        await (_db.selectOnly(_db.pendingMutations)
              ..addColumns([next])
              ..where(_db.pendingMutations.status.equals('pending')))
            .getSingle();
    return row.read(next);
  }

  /// The oldest due changes, marked `syncing` so they aren't edited while
  /// they're on their way.
  Future<List<PendingMutationRow>> _takeDue(DateTime now) =>
      _db.transaction(() async {
        final due =
            await (_db.select(_db.pendingMutations)
                  ..where(
                    (t) =>
                        t.status.equals('pending') &
                        (t.nextAttemptAt.isNull() |
                            t.nextAttemptAt.isSmallerOrEqualValue(now)),
                  )
                  ..orderBy([(t) => OrderingTerm(expression: t.id)])
                  ..limit(batchSize))
                .get();
        // A change based on an earlier one in this batch waits for the next
        // batch: by then its base_version is the server's id, not the
        // phone's.
        final batch = <PendingMutationRow>[];
        final madeHere = <Object?>{};
        for (final m in due) {
          final payload = jsonDecode(m.payload) as Map<String, dynamic>;
          if (_bases.any((b) => madeHere.contains(payload[b]))) break;
          if (payload['_fieldValueId'] != null) {
            madeHere.add(payload['_fieldValueId']);
          }
          // A member added on the phone (each of its details), or a
          // household's address and location.
          if (payload['_fieldValueIds'] case final Map<String, dynamic> ids) {
            madeHere.addAll(ids.values);
          }
          batch.add(m);
        }
        await (_db.update(_db.pendingMutations)
              ..where((t) => t.id.isIn(batch.map((m) => m.id))))
            .write(const PendingMutationsCompanion(status: Value('syncing')));
        return batch;
      });

  Future<void> _retryLater(
    List<PendingMutationRow> mutations,
    DateTime now,
    String code,
  ) async {
    for (final m in mutations) {
      final attempts = m.attempts + 1;
      await (_db.update(
        _db.pendingMutations,
      )..where((t) => t.id.equals(m.id))).write(
        PendingMutationsCompanion(
          status: const Value('pending'),
          attempts: Value(attempts),
          nextAttemptAt: Value(now.add(backoff(attempts, _random))),
          lastError: Value(code),
        ),
      );
    }
  }

  /// The payload as the API takes it: without the phone's own keys ("_…").
  static Map<String, dynamic> _toSend(String payload) =>
      (jsonDecode(payload) as Map<String, dynamic>)
        ..removeWhere((key, _) => key.startsWith('_'));

  Future<void> _setStatus(PendingMutationRow m, String status, String code) =>
      (_db.update(_db.pendingMutations)..where((t) => t.id.equals(m.id))).write(
        PendingMutationsCompanion(
          status: Value(status),
          attempts: Value(m.attempts + 1),
          // Not retried by itself: Upload now, or choosing a value.
          nextAttemptAt: const Value(null),
          lastError: Value(code),
        ),
      );

  /// The payload keys that name the value a change was based on: a field's
  /// (`field.change`), and a household's address and location
  /// (`household.update`).
  static const _bases = [
    'baseVersion',
    'addressBaseVersion',
    'locationBaseVersion',
  ];

  /// Gives the phone's copy the server's ids, so the next pull updates it
  /// instead of adding a second copy.
  Future<void> _reconcile(
    PendingMutationRow mutation,
    Map<String, dynamic> response,
  ) async {
    final payload = jsonDecode(mutation.payload) as Map<String, dynamic>;
    final result = response['result'];
    if (result is! Map<String, dynamic>) return;
    switch (mutation.type) {
      case 'visit.create':
        final serverId = result['id'];
        final clientId = payload['clientId'];
        // Anything unexpected is left for the next pull to settle; it never
        // stops the rest of the batch.
        if (serverId is String && clientId is String) {
          await (_db.update(_db.visits)
                ..where((t) => t.clientId.equals(clientId)))
              .write(VisitsCompanion(serverId: Value(serverId)));
        }
      case 'member.create':
        // Each detail's server id, from the field it saved.
        final localIds = payload['_fieldValueIds'];
        final saved = result['fields'];
        if (localIds is! Map<String, dynamic> || saved is! List<dynamic>) {
          return;
        }
        for (final field in saved.whereType<Map<String, dynamic>>()) {
          final localId = localIds[field['fieldKey']];
          final serverId = field['fieldValueId'];
          if (localId is String && serverId is String) {
            await _adopt(localId, serverId, null);
          }
        }
      case 'household.update':
        // The address and location, each from its own result.
        final localIds = payload['_fieldValueIds'];
        final results = result['results'];
        if (localIds is! Map<String, dynamic> ||
            results is! Map<String, dynamic>) {
          return;
        }
        for (final (name, key) in const [
          ('address', 'address'),
          ('location', 'household_location'),
        ]) {
          final saved = results[name];
          final localId = localIds[key];
          if (saved is Map<String, dynamic> &&
              saved['fieldValueId'] is String &&
              localId is String) {
            await _adopt(
              localId,
              saved['fieldValueId'] as String,
              saved['conflictWithId'] as String?,
            );
          }
        }
      case 'field.change':
        final serverId = result['fieldValueId'];
        final localId = payload['_fieldValueId'];
        if (serverId is String && localId is String) {
          await _adopt(localId, serverId, result['conflictWithId'] as String?);
        }
    }
  }

  /// The phone's value [localId] takes the server's id [serverId] (or goes,
  /// if a pull already brought the server's copy). A later edit on the phone
  /// points at it by its new id, and so does its queued change.
  Future<void> _adopt(
    String localId,
    String serverId,
    String? conflictWithId,
  ) async {
    if (localId == serverId) return;
    final pulled = await (_db.select(
      _db.fieldValues,
    )..where((t) => t.id.equals(serverId))).getSingleOrNull();
    if (pulled != null) {
      await (_db.delete(
        _db.fieldValues,
      )..where((t) => t.id.equals(localId))).go();
      return;
    }
    await (_db.update(
      _db.fieldValues,
    )..where((t) => t.id.equals(localId))).write(
      FieldValuesCompanion(
        id: Value(serverId),
        conflictWithId: Value(conflictWithId),
      ),
    );
    await (_db.update(_db.fieldValues)
          ..where((t) => t.supersedesId.equals(localId)))
        .write(FieldValuesCompanion(supersedesId: Value(serverId)));
    for (final base in _bases) {
      await _db.customUpdate(
        "UPDATE pending_mutation SET payload = json_set(payload, '\$.$base', ?1) "
        "WHERE json_extract(payload, '\$.$base') = ?2",
        variables: [Variable<String>(serverId), Variable<String>(localId)],
        updates: {_db.pendingMutations},
      );
    }
  }
}
