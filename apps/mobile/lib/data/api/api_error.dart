import 'package:dio/dio.dart';

/// A failed API call: the API's error `code` (e.g. `OTP_INVALID`), or
/// [network] when the server couldn't be reached.
class ApiError implements Exception {
  const ApiError(this.code, {this.status, this.requestId});

  /// No answer from the server: offline, timed out, or refused.
  static const network = 'NETWORK';

  /// An answer that isn't the API's error body.
  static const unexpected = 'INTERNAL_ERROR';

  final String code;
  final int? status;

  /// The API's request id, for support; never shown with personal data.
  final String? requestId;

  bool get isNetwork => code == network;

  factory ApiError.fromDio(DioException e) {
    final response = e.response;
    if (response == null) return const ApiError(network);
    final body = response.data;
    if (body is Map && body['code'] is String) {
      return ApiError(
        body['code'] as String,
        status: response.statusCode,
        requestId: body['requestId'] as String?,
      );
    }
    return ApiError(unexpected, status: response.statusCode);
  }

  @override
  String toString() => 'ApiError($code, status: $status)';
}
