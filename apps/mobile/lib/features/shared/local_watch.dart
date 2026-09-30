import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show StreamProviderFamily;

import '../../data/local/app_database.dart';
import '../../data/local/local_store.dart';
import '../auth/auth_controller.dart';

/// A provider over a watch on the phone's database. Screens read only the
/// database (never the API), so they work offline.
StreamProvider<T> localWatch<T>(Stream<T> Function(AppDatabase db) watch) =>
    StreamProvider<T>((ref) {
      // Signed out, the database is being wiped or gone: reading it would
      // open a new one (with a new key) while the screen is still up.
      if (ref.watch(authProvider) != AuthStatus.signedIn) {
        return const Stream.empty();
      }
      // Loading until the database is open; then the watch itself.
      final db = ref.watch(appDatabaseProvider).value;
      return db == null ? const Stream.empty() : watch(db);
    });

/// [localWatch] for one item, e.g. a household by id. Disposed when no
/// screen shows it any more.
StreamProviderFamily<T, A> localWatchFamily<T, A>(
  Stream<T> Function(AppDatabase db, A arg) watch,
) => StreamProvider.autoDispose.family<T, A>((ref, arg) {
  if (ref.watch(authProvider) != AuthStatus.signedIn) {
    return const Stream.empty();
  }
  final db = ref.watch(appDatabaseProvider).value;
  return db == null ? const Stream.empty() : watch(db, arg);
});
