import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_controller.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/home/home_screen.dart';
import '../features/households/household_address_screen.dart';
import '../features/households/household_screen.dart';
import '../features/households/households_screen.dart';
import '../features/households/new_household_screen.dart';
import '../features/members/member_screen.dart';
import '../features/sync/sync_screen.dart';
import '../features/visit/visit_screen.dart';
import '../widgets/states.dart';
import 'not_found_screen.dart';

/// The app's paths.
abstract final class Routes {
  static const starting = '/starting';
  static const signIn = '/sign-in';
  static const home = '/';
  static const households = '/households';
  static const newHousehold = '/households/new';
  static const sync = '/sync';
  static String household(String id) => '/household/${Uri.encodeComponent(id)}';
  static String householdAddress(String id) => '${household(id)}/address';
  static String newMember(String householdId) =>
      '${household(householdId)}/members/new';
  static String member(String id) => '/member/${Uri.encodeComponent(id)}';
  static String visit(String householdId) =>
      '/visit/${Uri.encodeComponent(householdId)}';
}

/// Where the router sends [uri] for someone who is [status], or null to stay.
///
/// Starting: wait on `/starting`. Signed out: sign-in. Both remember the page
/// that was asked for in `from`. Signed in: from starting or sign-in, on to
/// `from` (a path in this app only), or home.
String? authRedirect(AuthStatus status, Uri uri) {
  final waiting = uri.path == Routes.starting || uri.path == Routes.signIn;
  final target = waiting
      ? _safeFrom(uri.queryParameters['from'])
      : uri.toString();
  String withFrom(String path) => target == Routes.home
      ? path
      : Uri(path: path, queryParameters: {'from': target}).toString();

  return switch (status) {
    AuthStatus.starting =>
      uri.path == Routes.starting ? null : withFrom(Routes.starting),
    AuthStatus.signedOut =>
      uri.path == Routes.signIn ? null : withFrom(Routes.signIn),
    AuthStatus.signedIn => waiting ? target : null,
  };
}

/// [from] when it is a page of this app, otherwise home.
String _safeFrom(String? from) {
  final inApp =
      from != null &&
      from.startsWith('/') &&
      !from.startsWith('//') &&
      Uri.parse(from).path != Routes.signIn &&
      Uri.parse(from).path != Routes.starting;
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
        path: Routes.starting,
        builder: (context, state) => const Scaffold(body: LoadingState()),
      ),
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
        path: Routes.newHousehold,
        builder: (context, state) => const NewHouseholdScreen(),
      ),
      GoRoute(
        path: '/household/:id',
        builder: (context, state) =>
            HouseholdScreen(householdId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/household/:id/address',
        builder: (context, state) =>
            HouseholdAddressScreen(householdId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/household/:id/members/new',
        builder: (context, state) =>
            MemberScreen.add(householdId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/member/:id',
        builder: (context, state) =>
            MemberScreen(memberId: state.pathParameters['id']!),
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
