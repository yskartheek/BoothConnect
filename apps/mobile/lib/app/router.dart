import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_controller.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/home/home_screen.dart';
import '../features/households/household_screen.dart';
import '../features/households/households_screen.dart';
import '../features/sync/sync_screen.dart';
import '../features/visit/visit_screen.dart';
import 'not_found_screen.dart';

/// The app's paths.
abstract final class Routes {
  static const signIn = '/sign-in';
  static const home = '/';
  static const households = '/households';
  static const sync = '/sync';
  static String household(String id) => '/household/${Uri.encodeComponent(id)}';
  static String visit(String householdId) =>
      '/visit/${Uri.encodeComponent(householdId)}';
}

/// Where the router sends [uri] for someone who is [status], or null to stay.
///
/// Signed out: everything but sign-in goes to sign-in, remembering the page
/// in `from`. Signed in: sign-in goes on to `from` (a path in this app
/// only), or home.
String? authRedirect(AuthStatus status, Uri uri) {
  final atSignIn = uri.path == Routes.signIn;
  if (status == AuthStatus.signedOut) {
    if (atSignIn) return null;
    final from = uri.toString();
    if (from == Routes.home) return Routes.signIn;
    return Uri(path: Routes.signIn, queryParameters: {'from': from}).toString();
  }
  if (!atSignIn) return null;
  final from = uri.queryParameters['from'];
  final inApp =
      from != null &&
      from.startsWith('/') &&
      !from.startsWith('//') &&
      Uri.parse(from).path != Routes.signIn;
  return inApp ? from : Routes.home;
}

final routerProvider = Provider<GoRouter>((ref) {
  // go_router re-runs the redirect when this changes.
  final auth = ValueNotifier(ref.read(authProvider));
  ref.listen(authProvider, (_, next) => auth.value = next);

  final router = GoRouter(
    refreshListenable: auth,
    redirect: (context, state) => authRedirect(auth.value, state.uri),
    errorBuilder: (context, state) => const NotFoundScreen(),
    routes: [
      GoRoute(
        path: Routes.signIn,
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: Routes.home,
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: Routes.households,
        builder: (context, state) => const HouseholdsScreen(),
      ),
      GoRoute(
        path: '/household/:id',
        builder: (context, state) =>
            HouseholdScreen(householdId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/visit/:householdId',
        builder: (context, state) =>
            VisitScreen(householdId: state.pathParameters['householdId']!),
      ),
      GoRoute(
        path: Routes.sync,
        builder: (context, state) => const SyncScreen(),
      ),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    auth.dispose();
  });
  return router;
});
