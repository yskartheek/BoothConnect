import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import 'sync_controller.dart';

/// Syncs (uploads the changes waiting on the phone, then downloads) when
/// the volunteer signs in (or the app opens with a stored session), when
/// the app comes back to the foreground, and when the phone is back online.
/// Pull-to-refresh calls `SyncController.pullNow` itself; a saved visit
/// calls `pushNow`.
class SyncTriggers extends ConsumerStatefulWidget {
  const SyncTriggers({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<SyncTriggers> createState() => _SyncTriggersState();
}

class _SyncTriggersState extends ConsumerState<SyncTriggers> {
  late final AppLifecycleListener _lifecycle;

  bool get _signedIn => ref.read(authProvider) == AuthStatus.signedIn;

  void _sync() {
    if (_signedIn) {
      unawaited(ref.read(syncControllerProvider.notifier).syncNow());
    }
  }

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _sync);
    // Through onlineProvider, the connection stream's only listener: the
    // phone's stream takes one, and the offline banner reads it too.
    ref.listenManual(onlineProvider, (previous, next) {
      if (next.value == true && previous?.value == false) _sync();
    });
    ref.listenManual(authProvider, (previous, next) {
      if (next == AuthStatus.signedIn && previous != AuthStatus.signedIn) {
        _sync();
      }
    }, fireImmediately: true);
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
