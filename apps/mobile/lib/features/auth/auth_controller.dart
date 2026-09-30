import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/providers.dart';
import '../../data/local/local_store.dart';
import '../sync/sync_controller.dart';

enum AuthStatus {
  /// Checking for a stored session at launch.
  starting,
  signedOut,
  signedIn,
}

/// What [AuthController.signIn] ended with.
enum SignInResult {
  signedIn,

  /// Signed in, but with no volunteer assignment: the session is ended again.
  noAssignment,
}

/// Whether a volunteer is signed in. The router follows it.
class AuthController extends Notifier<AuthStatus> {
  @override
  AuthStatus build() {
    unawaited(_restore());
    return AuthStatus.starting;
  }

  /// A stored session counts as signed in, even offline: the app works from
  /// its local data, and the API says when the session is over.
  Future<void> _restore() async {
    final stored = await ref.read(authApiProvider).hasSession();
    if (state == AuthStatus.starting) {
      state = stored ? AuthStatus.signedIn : AuthStatus.signedOut;
    }
  }

  /// Signs in with the code, then checks the user is a volunteer. Throws
  /// `ApiError` (wrong code, offline, …).
  Future<SignInResult> signIn(String phone, String code) async {
    final api = ref.read(authApiProvider);
    await api.verifyOtp(phone, code);
    final me = await api.me();
    if (!me.isVolunteer) {
      await api.logout();
      return SignInResult.noAssignment;
    }
    // Another volunteer's data (left by an ended session) is wiped first.
    await ref.read(syncControllerProvider.notifier).prepareFor(me.id);
    state = AuthStatus.signedIn;
    return SignInResult.signedIn;
  }

  /// The API refused the refresh token: sign in again. The local data stays,
  /// since it may hold changes not yet uploaded.
  void sessionEnded() => state = AuthStatus.signedOut;

  /// Signs out: ends the session and wipes the phone's database and its key,
  /// so the next volunteer on this phone starts empty.
  Future<void> signOut() async {
    await ref.read(authApiProvider).logout();
    await ref.read(localStoreProvider).wipe();
    ref.invalidate(appDatabaseProvider);
    state = AuthStatus.signedOut;
  }
}

final authProvider = NotifierProvider<AuthController, AuthStatus>(
  AuthController.new,
);
