import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_error.dart';
import '../../data/api/auth_api.dart';
import '../../data/api/providers.dart';
import '../../data/local/local_reads.dart';
import '../../data/local/local_store.dart';
import '../../data/sync/push_repository.dart';
import '../../data/sync/sync_api.dart';
import '../../data/sync/sync_repository.dart';
import '../auth/auth_controller.dart';

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
    this.uploading = false,
  });

  /// The last pull.
  final SyncPhase phase;
  final DateTime? lastPullAt;
  final String? errorCode;

  /// Changes on the phone are being uploaded.
  final bool uploading;

  SyncState copyWith({
    SyncPhase? phase,
    DateTime? lastPullAt,
    String? errorCode,
    bool? uploading,
  }) => SyncState(
    phase: phase ?? this.phase,
    lastPullAt: lastPullAt ?? this.lastPullAt,
    errorCode: errorCode,
    uploading: uploading ?? this.uploading,
  );
}

final syncApiProvider = Provider<SyncApi>(
  (ref) => SyncApi(ref.watch(dioProvider)),
);

/// The phone's connectivity: the current state, then each change. A
/// single-subscription stream: read it through [onlineProvider], never
/// directly. Tests override it.
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

/// Runs sync: uploads (push) and downloads (pull), each one at a time,
/// however many triggers fire.
class SyncController extends Notifier<SyncState> {
  Future<void>? _running;
  Future<PushResult?>? _pushing;
  Timer? _retry;

  @override
  SyncState build() {
    ref.onDispose(() => _retry?.cancel());
    return const SyncState();
  }

  Future<PushRepository> _pushRepository() async => PushRepository(
    await ref.read(appDatabaseProvider.future),
    ref.read(syncApiProvider),
  );

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
          BoothAssignment(id: a.nodeId, name: a.nodeName, code: a.nodeCode),
    ]);
  }

  /// Pulls now (after sign-in, on resume, when back online, or on
  /// pull-to-refresh). A pull already running is joined, not repeated.
  Future<void> pullNow() => _running ??= _pull().whenComplete(() {
    _running = null;
  });

  /// Uploads, then downloads: the pull then brings back what was uploaded.
  /// On sign-in, resume and when back online.
  ///
  /// Changes waiting for their next try go now: the backoff is for an
  /// unreachable server while the phone seems online, not for a phone that
  /// was offline and is back.
  Future<void> syncNow() async {
    if (ref.read(authProvider) == AuthStatus.signedIn) {
      await (await _pushRepository()).dueNow();
    }
    await pushNow();
    await pullNow();
  }

  /// Uploads the changes that are due now. A push already running is
  /// joined: only one runs at a time, so a change is never sent twice at
  /// once.
  Future<PushResult?> pushNow() => _pushing ??= _push().whenComplete(() {
    _pushing = null;
  });

  /// Upload now: every change waiting, including those the server refused.
  Future<PushResult?> retryUploads() async {
    await whenIdle();
    await (await _pushRepository()).retryNow();
    return pushNow();
  }

  /// Retry one change now.
  Future<PushResult?> retryUpload(int id) async {
    await (await _pushRepository()).retryOne(id);
    return pushNow();
  }

  /// Completes when no pull or push is running.
  Future<void> whenIdle() async {
    while (_running != null || _pushing != null) {
      await _running;
      await _pushing;
    }
  }

  Future<PushResult?> _push() async {
    _retry?.cancel();
    // Signed out, the database is being wiped: nothing to upload.
    if (ref.read(authProvider) != AuthStatus.signedIn) return null;
    state = state.copyWith(uploading: true, errorCode: state.errorCode);
    try {
      final repository = await _pushRepository();
      final result = await repository.pushDue();
      // Changes that couldn't be sent: try again when they're due.
      final next = await repository.nextAttemptAt();
      if (next != null) {
        _retry = Timer(
          next.difference(DateTime.now()) + const Duration(milliseconds: 50),
          () => unawaited(pushNow()),
        );
      }
      return result;
    } finally {
      state = state.copyWith(uploading: false, errorCode: state.errorCode);
    }
  }

  Future<void> _pull() async {
    state = state.copyWith(phase: SyncPhase.syncing);
    try {
      final repository = await _repository();
      await repository.pull();
      state = SyncState(
        lastPullAt: await repository.lastPullAt(),
        uploading: state.uploading,
      );
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
