import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/auth_controller.dart';
import '../local/database_key.dart';
import 'api_client.dart';
import 'api_config.dart';
import 'auth_api.dart';
import 'token_store.dart';

final tokenStoreProvider = Provider<TokenStore>(
  (ref) => TokenStore(ref.watch(secretStoreProvider)),
);

final dioProvider = Provider<Dio>((ref) {
  final dio = createApiDio(
    baseUrl: ApiConfig.baseUrl,
    tokens: ref.watch(tokenStoreProvider),
    onSessionEnded: () => ref.read(authProvider.notifier).sessionEnded(),
  );
  ref.onDispose(dio.close);
  return dio;
});

final authApiProvider = Provider<AuthApi>(
  (ref) => AuthApi(ref.watch(dioProvider), ref.watch(tokenStoreProvider)),
);
