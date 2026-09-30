import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_error.dart';
import '../../data/api/auth_api.dart';
import '../../data/api/providers.dart';
import '../../data/local/local_reads.dart';
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

/// The phone's connectivity: the current state, then each change. Tests
/// override it.
final connectivityChangesProvider = Provider<Stream<List<ConnectivityResult>>>((
  ref,
) async* {
  final connectivity = Connectivity();
  yield await connectivity.checkConnectivity();
  yield* connectivity.onConnectivityChanged;
});

/// Whether the phone has a connection (true until it says otherwise).
final onlineProvider = StreamProvider<bool>(
  (ref) => ref
      .watch(connectivityChangesProvider)
      .map((results) => results.any((r) => r != ConnectivityResult.none)),
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

  /// Before the first pull for [me]: a database holding another
  /// volunteer's data (their session ended without a sign-out) is wiped.
  /// Then it records who owns it and their booths.
  Future<void> prepareFor(Me me) async {
    final owner = await (await _repository()).owner();
    if (owner != null && owner != me.id) {
      await ref.read(localStoreProvider).wipe();
      ref.invalidate(appDatabaseProvider);
      state = const SyncState();
    }
    final repository = await _repository();
    await repository.setOwner(me.id);
    await repository.setBooths([
      for (final a in me.assignments)
        if (a.role == 'volunteer')
          BoothAssignment(name: a.nodeName, code: a.nodeCode),
    ]);
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
