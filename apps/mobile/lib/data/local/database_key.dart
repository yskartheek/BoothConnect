import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where secrets are kept: the Android Keystore or iOS Keychain in the app.
abstract interface class SecretStore {
  Future<String?> read(String name);
  Future<void> write(String name, String value);
  Future<void> delete(String name);
}

/// Secure storage (Android Keystore / iOS Keychain); tests use memory.
final secretStoreProvider = Provider<SecretStore>(
  (ref) => const SecureStorageSecrets(),
);

/// [SecretStore] on `flutter_secure_storage`.
class SecureStorageSecrets implements SecretStore {
  const SecureStorageSecrets([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String name) => _storage.read(key: name);

  @override
  Future<void> write(String name, String value) =>
      _storage.write(key: name, value: value);

  @override
  Future<void> delete(String name) => _storage.delete(key: name);
}

/// The database key: 256 random bits, made on first use and kept in the
/// [SecretStore]. It never leaves the phone.
class DatabaseKeyStore {
  DatabaseKeyStore(this._secrets, {Random? random})
    : _random = random ?? Random.secure();

  static const secretName = 'bc_db_key_v1';

  final SecretStore _secrets;
  final Random _random;

  /// The key as 64 hex digits; created and stored the first time.
  Future<String> readOrCreate() async {
    final stored = await _secrets.read(secretName);
    if (stored != null && isValidKey(stored)) return stored;
    final key = List.generate(
      32,
      (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    await _secrets.write(secretName, key);
    return key;
  }

  Future<void> delete() => _secrets.delete(secretName);

  static bool isValidKey(String key) => RegExp(r'^[0-9a-f]{64}$').hasMatch(key);
}
