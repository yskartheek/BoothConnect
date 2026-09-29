import 'package:boothconnect_mobile/data/local/database_key.dart';

/// Secrets in memory, standing in for the Keystore / Keychain.
class MemorySecrets implements SecretStore {
  final values = <String, String>{};

  @override
  Future<String?> read(String name) async => values[name];

  @override
  Future<void> write(String name, String value) async => values[name] = value;

  @override
  Future<void> delete(String name) async => values.remove(name);
}
