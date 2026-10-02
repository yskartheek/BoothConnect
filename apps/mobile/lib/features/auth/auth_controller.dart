import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/providers.dart';
import '../../data/local/local_store.dart';
import '../sync/sync_controller.dart';

enum AuthStatus {
  /// Checking for a stored session at launch.
  starting,
  signedOut,

  /// A volunteer is signed in.
  signedIn,

  /// A voter is signed in (#226): the voter side of the app, online only.
  /// It never opens the phone's database.
  voter,
}

/// What [AuthController.signIn] ended with.
enum SignInResult {
  signedIn,

  /// Signed in, but with no volunteer assignment (or, for a voter, not as
  /// a voter): the session is ended again.
  noAssignment,
}

/// Who is signed in: a volunteer, a voter, or no one. The router follows it.
class AuthController extends Notifier<AuthStatus> {
  @override
  AuthStatus build() {
    unawaited(_restore());
    return AuthStatus.starting;
  }

  /// A stored session counts as signed in, even offline: the app works from
  /// its local data, and the API says when the session is over.
  Future<void> _restore() async {
    final api = ref.read(authApiProvider);
    final stored = await api.hasSession();
    final voter = stored && await api.isVoterSession();
    if (state == AuthStatus.starting) {
      state = !stored
          ? AuthStatus.signedOut
          : voter
          ? AuthStatus.voter
          : AuthStatus.signedIn;
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
    await ref.read(syncControllerProvider.notifier).prepareFor(me);
    state = AuthStatus.signedIn;
    return SignInResult.signedIn;
  }

  /// A voter signs in (#226) with their voter ID (EPIC), the mobile number on
  /// their record and the code. Throws `ApiError` (wrong code, offline, …).
  Future<SignInResult> signInVoter(
    String epic,
    String phone,
    String code,
  ) async {
    final api = ref.read(authApiProvider);
    await api.verifyVoterOtp(epic, phone, code);
    final me = await api.me();
    if (!me.isVoter) {
      await api.logout();
      return SignInResult.noAssignment;
    }
    state = AuthStatus.voter;
    return SignInResult.signedIn;
  }

  /// The API refused the refresh token: sign in again. The local data stays,
  /// since it may hold changes not yet uploaded.
  void sessionEnded() => state = AuthStatus.signedOut;

  /// Signs out: ends the session and wipes the phone's database and its key,
  /// so the next volunteer on this phone starts empty.
  Future<void> signOut() async {
    final wasVoter = state == AuthStatus.voter;
    await ref.read(authApiProvider).logout();
    // A voter's side keeps nothing on the phone but the tokens.
    if (wasVoter) {
      state = AuthStatus.signedOut;
      return;
    }
    // Signed out first: screens stop reading and no new pull starts. Then
    // a pull still running finishes before the wipe, so nothing reopens
    // the database (with a new key) behind it.
    state = AuthStatus.signedOut;
    await ref.read(syncControllerProvider.notifier).whenIdle();
    await ref.read(localStoreProvider).wipe();
  }
}

final authProvider = NotifierProvider<AuthController, AuthStatus>(
  AuthController.new,
);
