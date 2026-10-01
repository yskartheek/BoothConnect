import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_error.dart';
import 'token_store.dart';

/// One of the user's role assignments (`GET /v1/me`).
class Assignment {
  const Assignment({
    required this.role,
    this.nodeId,
    required this.nodeType,
    required this.nodeName,
    required this.nodeCode,
  });

  factory Assignment.fromJson(Map<String, dynamic> json) {
    final node = json['node'] as Map<String, dynamic>;
    return Assignment(
      role: json['role'] as String,
      nodeId: node['id'] as String?,
      nodeType: node['type'] as String,
      nodeName: node['name'] as String,
      nodeCode: node['code'] as String,
    );
  }

  final String role;
  final String? nodeId;
  final String nodeType;
  final String nodeName;
  final String nodeCode;
}

/// The signed-in user (`GET /v1/me`).
class Me {
  const Me({required this.id, required this.name, required this.assignments});

  factory Me.fromJson(Map<String, dynamic> json) => Me(
    id: json['id'] as String,
    name: json['name'] as String,
    assignments: [
      for (final a in json['assignments'] as List<dynamic>)
        Assignment.fromJson(a as Map<String, dynamic>),
    ],
  );

  final String id;
  final String name;
  final List<Assignment> assignments;

  /// The app is for volunteers: someone with no volunteer assignment can't
  /// use it.
  bool get isVolunteer => assignments.any((a) => a.role == 'volunteer');
}

/// Sign-in, sign-out and the current user. Failures are [ApiError]s.
class AuthApi {
  AuthApi(this._dio, this._tokens);

  final Dio _dio;
  final TokenStore _tokens;

  /// Whether tokens from an earlier sign-in are stored.
  Future<bool> hasSession() async => await _tokens.read() != null;

  /// Asks the API to text a code to [phone] (international format).
  Future<void> requestOtp(String phone) => _call(
    () => _dio.post<void>(
      '/v1/auth/otp/request',
      data: {'phone': phone},
      options: Options(extra: noAuth),
    ),
  );

  /// Exchanges the code for tokens, and keeps them.
  Future<void> verifyOtp(String phone, String code) async {
    final deviceId = await _tokens.deviceId();
    final response = await _call(
      () => _dio.post<Map<String, dynamic>>(
        '/v1/auth/otp/verify',
        data: {'phone': phone, 'code': code, 'deviceId': deviceId},
        options: Options(extra: noAuth),
      ),
    );
    final body = response.data!;
    await _tokens.save(
      Tokens(
        access: body['accessToken'] as String,
        refresh: body['refreshToken'] as String,
      ),
    );
  }

  Future<Me> me() async {
    final response = await _call(
      () => _dio.get<Map<String, dynamic>>('/v1/me'),
    );
    return Me.fromJson(response.data!);
  }

  /// Ends the session on the server (when reachable) and forgets the tokens.
  Future<void> logout() async {
    try {
      if (await _tokens.read() != null) {
        await _dio.post<void>('/v1/auth/logout');
      }
    } on DioException {
      // Offline or already ended: the tokens go anyway.
    } finally {
      await _tokens.clear();
    }
  }

  static Future<Response<T>> _call<T>(
    Future<Response<T>> Function() request,
  ) async {
    try {
      return await request();
    } on DioException catch (e) {
      throw ApiError.fromDio(e);
    }
  }
}
