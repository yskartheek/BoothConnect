import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/api/auth_api.dart';

/// The code the fake accepts.
const goodCode = '123456';

const volunteerAssignment = Assignment(
  role: 'volunteer',
  nodeType: 'polling_station',
  nodeName: 'Demo Primary School',
  nodeCode: '1',
);

/// [AuthApi] without a server. Synthetic users only.
class FakeAuthApi implements AuthApi {
  FakeAuthApi({
    this.session = false,
    this.assignments = const [volunteerAssignment],
    this.failWith,
  });

  bool session;
  List<Assignment> assignments;

  /// Thrown by every call when set (e.g. `ApiError(ApiError.network)`).
  ApiError? failWith;

  final requested = <String>[];
  final verified = <(String, String)>[];
  var logouts = 0;

  @override
  Future<bool> hasSession() async => session;

  @override
  Future<void> requestOtp(String phone) async {
    if (failWith != null) throw failWith!;
    requested.add(phone);
  }

  @override
  Future<void> verifyOtp(String phone, String code) async {
    if (failWith != null) throw failWith!;
    verified.add((phone, code));
    if (code != goodCode) throw const ApiError('OTP_INVALID', status: 401);
    session = true;
  }

  @override
  Future<Me> me() async =>
      Me(id: 'u-1', name: 'Test Volunteer', assignments: assignments);

  @override
  Future<void> logout() async {
    logouts++;
    session = false;
  }
}
