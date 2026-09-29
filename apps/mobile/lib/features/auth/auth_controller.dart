import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/local/local_store.dart';

enum AuthStatus { signedOut, signedIn }

/// Whether a volunteer is signed in. The router sends a signed-out user to
/// sign-in. OTP sign-in and the stored tokens (#60) set this later; until
/// then the app starts signed out.
class AuthController extends Notifier<AuthStatus> {
  @override
  AuthStatus build() => AuthStatus.signedOut;

  void signedIn() => state = AuthStatus.signedIn;

  /// Signs out and wipes the phone's database and its key first: the next
  /// volunteer on this phone starts empty.
  Future<void> signOut() async {
    await ref.read(localStoreProvider).wipe();
    ref.invalidate(appDatabaseProvider);
    state = AuthStatus.signedOut;
  }
}

final authProvider = NotifierProvider<AuthController, AuthStatus>(
  AuthController.new,
);
