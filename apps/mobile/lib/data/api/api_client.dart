import 'dart:async';
import 'dart:math';

import 'package:dio/dio.dart';

import 'token_store.dart';

/// Marks a request that must go without the access token (sign-in calls):
/// `Options(extra: noAuth)`.
const noAuth = {'auth': false};

const _retriedKey = 'retried';

/// The API client: JSON, a request id on every call, the access token, and a
/// refresh-and-retry on 401.
///
/// [onSessionEnded] runs when the refresh token is refused too: the volunteer
/// must sign in again.
Dio createApiDio({
  required String baseUrl,
  required TokenStore tokens,
  required void Function() onSessionEnded,
  HttpClientAdapter? adapter,
  Random? random,
}) {
  final options = BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 30),
    contentType: Headers.jsonContentType,
    responseType: ResponseType.json,
  );
  final dio = Dio(options);
  // Refresh calls go through their own client: no token, no retry loop.
  final refreshDio = Dio(options);
  if (adapter != null) {
    dio.httpClientAdapter = adapter;
    refreshDio.httpClientAdapter = adapter;
  }
  final requestIds = RequestIdInterceptor(random ?? Random.secure());
  refreshDio.interceptors.add(requestIds);
  dio.interceptors.addAll([
    requestIds,
    AuthInterceptor(
      dio: dio,
      refreshDio: refreshDio,
      tokens: tokens,
      onSessionEnded: onSessionEnded,
    ),
  ]);
  return dio;
}

/// Sends `x-request-id`, so a failed call can be found in the API's log.
class RequestIdInterceptor extends Interceptor {
  RequestIdInterceptor(this._random);

  static const header = 'x-request-id';

  final Random _random;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.headers[header] ??= List.generate(
      16,
      (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    handler.next(options);
  }
}

/// Adds the access token. On a 401 it renews the tokens once and retries.
///
/// The API rotates refresh tokens and revokes the whole session when a used
/// one comes back, so concurrent 401s share one refresh ([_refreshing]).
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required this.dio,
    required this.refreshDio,
    required this.tokens,
    required this.onSessionEnded,
  });

  final Dio dio;
  final Dio refreshDio;
  final TokenStore tokens;
  final void Function() onSessionEnded;

  Future<Tokens?>? _refreshing;

  static bool _wantsAuth(RequestOptions options) =>
      options.extra['auth'] != false;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (_wantsAuth(options)) {
      final current = await tokens.read();
      if (current != null) {
        options.headers['authorization'] = 'Bearer ${current.access}';
      }
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final options = err.requestOptions;
    if (err.response?.statusCode != 401 ||
        !_wantsAuth(options) ||
        options.extra[_retriedKey] == true) {
      return handler.next(err);
    }
    Tokens? renewed;
    try {
      renewed = await _renew(options.headers['authorization'] as String?);
    } on DioException {
      // The refresh itself didn't get through (offline): keep the session.
      return handler.next(err);
    }
    if (renewed == null) {
      onSessionEnded();
      return handler.next(err);
    }
    options.headers['authorization'] = 'Bearer ${renewed.access}';
    options.extra[_retriedKey] = true;
    try {
      handler.resolve(await dio.fetch<dynamic>(options));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  /// New tokens, or null when the session is over. [sentWith] is the
  /// header the failed request carried: if the tokens changed since, another
  /// request already renewed them.
  Future<Tokens?> _renew(String? sentWith) {
    return _refreshing ??= _refresh(sentWith).whenComplete(() {
      _refreshing = null;
    });
  }

  Future<Tokens?> _refresh(String? sentWith) async {
    final current = await tokens.read();
    if (current == null) return null;
    if (sentWith != null && sentWith != 'Bearer ${current.access}') {
      return current;
    }
    try {
      final response = await refreshDio.post<Map<String, dynamic>>(
        '/v1/auth/refresh',
        data: {'refreshToken': current.refresh},
      );
      final body = response.data!;
      final renewed = Tokens(
        access: body['accessToken'] as String,
        refresh: body['refreshToken'] as String,
      );
      await tokens.save(renewed);
      return renewed;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        await tokens.clear();
        return null;
      }
      rethrow;
    }
  }
}
