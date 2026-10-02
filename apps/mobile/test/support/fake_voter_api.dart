import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/api/voter_api.dart';

/// A voter's record, as `GET /v1/voter/me` returns it. Synthetic data only.
VoterSelf syntheticVoter({
  String? name = 'Synthetic Lakshmi',
  Map<String, Object?> shared = const {
    'mobile_number': '+919999900101',
    'occupation': 'Teacher',
    'additional_info': null,
  },
}) => VoterSelf(
  id: 'v-1',
  epicNumber: 'SYN1000001',
  official: OfficialRecord(
    name: name,
    relationType: 'husband',
    relativeName: 'Synthetic Ravi',
    age: 46,
    gender: 'female',
    houseNumber: '1-3',
  ),
  sectionNo: 1,
  serialNo: 217,
  partCode: '408',
  partName: 'Demo Nagar',
  boothCode: '142',
  boothName: 'Demo Primary School',
  programName: 'Demo General Election 2026',
  householdAddress: 'H NO 1-3',
  shared: [
    for (final MapEntry(:key, :value) in shared.entries)
      SharedDetail(
        key: key,
        labelKey: 'field.$key',
        value: value,
        fieldValueId: value == null ? null : 'fv-$key',
      ),
  ],
);

/// [VoterApi] without a server.
class FakeVoterApi implements VoterApi {
  FakeVoterApi({VoterSelf? self, this.failWith})
    : self = self ?? syntheticVoter();

  VoterSelf self;

  /// Thrown by every call when set (e.g. `ApiError(ApiError.network)`).
  ApiError? failWith;
  var reads = 0;

  @override
  Future<VoterSelf> me() async {
    reads++;
    if (failWith != null) throw failWith!;
    return self;
  }
}
