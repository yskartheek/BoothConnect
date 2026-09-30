import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

import 'app_database.dart';
import 'database_key.dart';

/// Opens the phone's database, encrypted with SQLCipher, and wipes it.
class LocalStore {
  LocalStore({
    required this.directory,
    required this.keys,
    this.inBackground = true,
  });

  static const fileName = 'boothconnect.db';

  /// Where the database file lives (the app's private support folder).
  final Future<Directory> Function() directory;
  final DatabaseKeyStore keys;

  /// Runs queries on a background isolate (the app); tests use false.
  final bool inBackground;

  AppDatabase? _db;

  Future<File> file() async => File(p.join((await directory()).path, fileName));

  /// The database, opened with the key (created on first launch).
  Future<AppDatabase> open() async {
    if (_db != null) return _db!;
    final key = await keys.readOrCreate();
    final dbFile = await file();
    void setup(Database raw) => unlock(raw, key);
    final executor = inBackground
        ? NativeDatabase.createInBackground(dbFile, setup: setup)
        : NativeDatabase(dbFile, setup: setup);
    return _db = AppDatabase(executor);
  }

  /// Closes the database and deletes its files and key: nothing the
  /// volunteer collected stays on the phone after sign-out.
  Future<void> wipe() async {
    await _db?.close();
    _db = null;
    final dbFile = await file();
    for (final suffix in ['', '-wal', '-shm', '-journal']) {
      final f = File('${dbFile.path}$suffix');
      if (f.existsSync()) await f.delete();
    }
    await keys.delete();
  }

  /// Unlocks [raw] with [hexKey]. Refuses to go on without SQLCipher (the
  /// data would be written in plain text), and fails on a wrong key.
  static void unlock(Database raw, String hexKey) {
    if (!DatabaseKeyStore.isValidKey(hexKey)) {
      throw ArgumentError('The database key must be 64 hex digits');
    }
    if (raw.select('PRAGMA cipher_version').isEmpty) {
      throw StateError('SQLCipher is not available: not opening the database');
    }
    raw.execute("PRAGMA key = \"x'$hexKey'\"");
    // Reading the schema fails here, not later, when the key is wrong.
    raw.select('SELECT count(*) FROM sqlite_master');
  }
}

final localStoreProvider = Provider<LocalStore>(
  (ref) => LocalStore(
    directory: getApplicationSupportDirectory,
    keys: DatabaseKeyStore(ref.watch(secretStoreProvider)),
  ),
);

/// The open database. Invalidate it after [LocalStore.wipe].
final appDatabaseProvider = FutureProvider<AppDatabase>(
  (ref) => ref.watch(localStoreProvider).open(),
);
