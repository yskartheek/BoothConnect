import 'package:flutter_riverpod/flutter_riverpod.dart';

enum AuthStatus { signedOut, signedIn }

/// Whether a volunteer is signed in. The router sends a signed-out user to
/// sign-in. OTP sign-in and the stored tokens (#60) set this later; until
/// then the app starts signed out.
class AuthController extends Notifier<AuthStatus> {
  @override
  AuthStatus build() => AuthStatus.signedOut;

  void signedIn() => state = AuthStatus.signedIn;

  void signOut() => state = AuthStatus.signedOut;
}

final authProvider = NotifierProvider<AuthController, AuthStatus>(
  AuthController.new,
);
