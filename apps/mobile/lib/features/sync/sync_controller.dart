import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_error.dart';
import '../../data/api/providers.dart';
import '../../data/local/local_store.dart';
import '../../data/sync/sync_api.dart';
import '../../data/sync/sync_repository.dart';

enum SyncPhase {
  idle,
  syncing,

  /// The last pull couldn't reach the server. The local data is still used.
  offline,

  /// The last pull failed for another reason ([SyncState.errorCode]).
  failed,
}

class SyncState {
  const SyncState({
    this.phase = SyncPhase.idle,
    this.lastPullAt,
    this.errorCode,
  });

  final SyncPhase phase;
  final DateTime? lastPullAt;
  final String? errorCode;

  SyncState copyWith({
    SyncPhase? phase,
    DateTime? lastPullAt,
    String? errorCode,
  }) => SyncState(
    phase: phase ?? this.phase,
    lastPullAt: lastPullAt ?? this.lastPullAt,
    errorCode: errorCode,
  );
}

final syncApiProvider = Provider<SyncApi>(
  (ref) => SyncApi(ref.watch(dioProvider)),
);

/// Phone connectivity changes; tests override it.
final connectivityChangesProvider = Provider<Stream<List<ConnectivityResult>>>(
  (ref) => Connectivity().onConnectivityChanged,
);

/// Runs sync pulls: one at a time, however many triggers fire.
class SyncController extends Notifier<SyncState> {
  Future<void>? _running;

  @override
  SyncState build() => const SyncState();

  Future<SyncRepository> _repository() async => SyncRepository(
    await ref.read(appDatabaseProvider.future),
    ref.read(syncApiProvider),
  );

  /// Before the first pull for [userId]: a database holding another
  /// volunteer's data (their session ended without a sign-out) is wiped.
  Future<void> prepareFor(String userId) async {
    final owner = await (await _repository()).owner();
    if (owner != null && owner != userId) {
      await ref.read(localStoreProvider).wipe();
      ref.invalidate(appDatabaseProvider);
      state = const SyncState();
    }
    await (await _repository()).setOwner(userId);
  }

  /// Pulls now (after sign-in, on resume, when back online, or on
  /// pull-to-refresh). A pull already running is joined, not repeated.
  Future<void> pullNow() => _running ??= _pull().whenComplete(() {
    _running = null;
  });

  Future<void> _pull() async {
    state = state.copyWith(phase: SyncPhase.syncing);
    try {
      final repository = await _repository();
      await repository.pull();
      state = SyncState(lastPullAt: await repository.lastPullAt());
    } on ApiError catch (e) {
      state = state.copyWith(
        phase: e.isNetwork ? SyncPhase.offline : SyncPhase.failed,
        errorCode: e.code,
      );
    }
  }
}

final syncControllerProvider = NotifierProvider<SyncController, SyncState>(
  SyncController.new,
);
