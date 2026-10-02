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
  FakeVoterApi({
    VoterSelf? self,
    this.failWith,
    List<VoterUpdate>? updates,
    List<VoterConsent>? consents,
  }) : self = self ?? syntheticVoter(),
       updateList = updates ?? syntheticUpdates(),
       consentList = consents ?? [syntheticConsent()];

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

  /// Every save, in order.
  final saves = <List<DetailEdit>>[];

  /// The result for a detail; by default `applied`, and the value becomes
  /// the current one.
  String Function(DetailEdit edit) statusOf = (_) => 'applied';

  @override
  Future<List<DetailResult>> editDetails(List<DetailEdit> edits) async {
    if (failWith != null) throw failWith!;
    saves.add(edits);
    final results = [
      for (final e in edits) DetailResult(key: e.key, status: statusOf(e)),
    ];
    self = VoterSelf(
      id: self.id,
      epicNumber: self.epicNumber,
      official: self.official,
      sectionNo: self.sectionNo,
      serialNo: self.serialNo,
      partCode: self.partCode,
      partName: self.partName,
      boothCode: self.boothCode,
      boothName: self.boothName,
      programName: self.programName,
      householdAddress: self.householdAddress,
      shared: [
        for (final d in self.shared)
          switch (edits.where((e) => e.key == d.key).firstOrNull) {
            final DetailEdit e when statusOf(e) == 'applied' => SharedDetail(
              key: d.key,
              labelKey: d.labelKey,
              value: e.value,
              fieldValueId: 'fv-${d.key}-${saves.length}',
            ),
            _ => d,
          },
      ],
    );
    return results;
  }

  List<VoterUpdate> updateList;
  List<VoterConsent> consentList;

  /// Every consent withdrawn, in order.
  final withdrawn = <String>[];

  @override
  Future<List<VoterUpdate>> updates() async {
    if (failWith != null) throw failWith!;
    return updateList;
  }

  @override
  Future<List<VoterConsent>> consents() async {
    if (failWith != null) throw failWith!;
    return consentList;
  }

  @override
  Future<VoterConsent> withdrawConsent(String id) async {
    if (failWith != null) throw failWith!;
    withdrawn.add(id);
    final at = DateTime.utc(2026, 10, 2, 9);
    consentList = [
      for (final c in consentList)
        c.id == id && c.isGranted
            ? VoterConsent(
                id: c.id,
                purpose: c.purpose,
                status: 'withdrawn',
                capturedAt: c.capturedAt,
                withdrawnAt: at,
              )
            : c,
    ];
    return consentList.firstWhere((c) => c.id == id);
  }
}

/// A voter's history, newest first. Synthetic data only.
List<VoterUpdate> syntheticUpdates() => [
  VoterUpdate(
    kind: 'detail',
    fieldKey: 'mobile_number',
    by: 'you',
    at: DateTime.utc(2026, 9, 30, 10),
  ),
  VoterUpdate(
    kind: 'visit',
    outcome: 'no_one_available',
    at: DateTime.utc(2026, 9, 20, 11),
  ),
  VoterUpdate(
    kind: 'detail',
    fieldKey: 'occupation',
    by: 'volunteer',
    at: DateTime.utc(2026, 9, 20, 11),
  ),
  VoterUpdate(
    kind: 'detail',
    fieldKey: 'additional_info',
    by: 'admin',
    at: DateTime.utc(2026, 9, 10, 12),
  ),
  VoterUpdate(kind: 'joined', at: DateTime.utc(2026, 9, 1, 8)),
];

/// Caste / community, shared with the voter's consent. Synthetic.
VoterConsent syntheticConsent({String id = 'c-1', String status = 'granted'}) =>
    VoterConsent(
      id: id,
      purpose: 'caste_community',
      status: status,
      capturedAt: DateTime.utc(2026, 9, 20, 11),
      withdrawnAt: status == 'withdrawn' ? DateTime.utc(2026, 9, 25, 9) : null,
    );
