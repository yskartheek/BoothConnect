import 'package:dio/dio.dart';

import '../api/api_error.dart';

/// `GET /v1/sync/pull`: the volunteer's booths, one page at a time (the
/// API's `SyncPage`, as JSON). Failures are [ApiError]s.
class SyncApi {
  SyncApi(this._dio);

  final Dio _dio;

  /// Without [since], a full snapshot; with it, what changed since.
  Future<Map<String, dynamic>> pull({String? since, int? limit}) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/v1/sync/pull',
        queryParameters: {'since': ?since, 'limit': ?limit},
      );
      return response.data!;
    } on DioException catch (e) {
      throw ApiError.fromDio(e);
    }
  }

  /// Sends queued changes (`{key, type, payload}`), applied in order. Returns
  /// one result per change: `{key, status, result?, code?, …}`.
  Future<List<Map<String, dynamic>>> push(
    List<Map<String, Object?>> mutations,
  ) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/v1/sync/push',
        data: {'mutations': mutations},
      );
      return (response.data!['results'] as List<dynamic>)
          .cast<Map<String, dynamic>>();
    } on DioException catch (e) {
      throw ApiError.fromDio(e);
    }
  }
}
