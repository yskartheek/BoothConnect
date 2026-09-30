import 'dart:math';

import '../local/database_key.dart';

/// An access token and the refresh token that renews it.
class Tokens {
  const Tokens({required this.access, required this.refresh});

  final String access;
  final String refresh;
}

/// Keeps the tokens, and this installation's device id, in secure storage.
/// Reads are cached: the interceptor asks on every request.
class TokenStore {
  TokenStore(this._secrets, {Random? random})
    : _random = random ?? Random.secure();

  static const accessName = 'bc_access_token';
  static const refreshName = 'bc_refresh_token';
  static const deviceIdName = 'bc_device_id';

  final SecretStore _secrets;
  final Random _random;
  Tokens? _cached;
  bool _loaded = false;

  Future<Tokens?> read() async {
    if (_loaded) return _cached;
    final access = await _secrets.read(accessName);
    final refresh = await _secrets.read(refreshName);
    _cached = access != null && refresh != null
        ? Tokens(access: access, refresh: refresh)
        : null;
    _loaded = true;
    return _cached;
  }

  Future<void> save(Tokens tokens) async {
    await _secrets.write(accessName, tokens.access);
    await _secrets.write(refreshName, tokens.refresh);
    _cached = tokens;
    _loaded = true;
  }

  Future<void> clear() async {
    await _secrets.delete(accessName);
    await _secrets.delete(refreshName);
    _cached = null;
    _loaded = true;
  }

  /// A stable id for this installation (the API keeps one session per
  /// device). It stays across sign-outs.
  Future<String> deviceId() async {
    final stored = await _secrets.read(deviceIdName);
    if (stored != null) return stored;
    final id = List.generate(
      16,
      (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    await _secrets.write(deviceIdName, id);
    return id;
  }
}
