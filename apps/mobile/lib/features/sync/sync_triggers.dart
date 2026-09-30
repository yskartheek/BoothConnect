import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import 'sync_controller.dart';

/// Starts a sync pull when the volunteer signs in (or the app opens with a
/// stored session), when the app comes back to the foreground, and when
/// the phone is back online. Pull-to-refresh calls
/// `SyncController.pullNow` itself.
class SyncTriggers extends ConsumerStatefulWidget {
  const SyncTriggers({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<SyncTriggers> createState() => _SyncTriggersState();
}

class _SyncTriggersState extends ConsumerState<SyncTriggers> {
  late final AppLifecycleListener _lifecycle;
  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  var _offline = false;

  bool get _signedIn => ref.read(authProvider) == AuthStatus.signedIn;

  void _pull() {
    if (_signedIn) {
      unawaited(ref.read(syncControllerProvider.notifier).pullNow());
    }
  }

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _pull);
    _connectivity = ref.read(connectivityChangesProvider).listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online && _offline) _pull();
      _offline = !online;
    });
    ref.listenManual(authProvider, (previous, next) {
      if (next == AuthStatus.signedIn && previous != AuthStatus.signedIn) {
        _pull();
      }
    }, fireImmediately: true);
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    unawaited(_connectivity?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
