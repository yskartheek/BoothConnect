import 'package:dio/dio.dart';

import '../local/ids.dart';
import 'api_error.dart';

/// The signed-in voter's own record (`GET /v1/voter/me`, #224). Online only:
/// nothing of it is kept on the phone.
class VoterSelf {
  const VoterSelf({
    required this.id,
    required this.epicNumber,
    required this.official,
    required this.sectionNo,
    required this.serialNo,
    required this.partCode,
    required this.partName,
    required this.boothCode,
    required this.boothName,
    required this.programName,
    required this.householdAddress,
    required this.shared,
  });

  factory VoterSelf.fromJson(Map<String, dynamic> json) {
    final official = json['official'] as Map<String, dynamic>;
    final part = json['part'] as Map<String, dynamic>;
    final booth = json['booth'] as Map<String, dynamic>;
    return VoterSelf(
      id: json['id'] as String,
      epicNumber: json['epicNumber'] as String?,
      official: OfficialRecord(
        name: official['name'] as String?,
        relationType: official['relationType'] as String?,
        relativeName: official['relativeName'] as String?,
        age: (official['age'] as num?)?.toInt(),
        gender: official['gender'] as String?,
        houseNumber: official['houseNumber'] as String?,
      ),
      sectionNo: (json['sectionNo'] as num?)?.toInt(),
      serialNo: (json['serialNo'] as num?)?.toInt(),
      partCode: part['code'] as String,
      partName: part['name'] as String,
      boothCode: booth['code'] as String,
      boothName: booth['name'] as String,
      programName: (json['program'] as Map<String, dynamic>)['name'] as String,
      householdAddress:
          (json['household'] as Map<String, dynamic>)['address'] as String,
      shared: [
        for (final s in json['shared'] as List<dynamic>)
          SharedDetail.fromJson(s as Map<String, dynamic>),
      ],
    );
  }

  final String id;
  final String? epicNumber;
  final OfficialRecord official;
  final int? sectionNo;
  final int? serialNo;
  final String partCode;
  final String partName;
  final String boothCode;
  final String boothName;
  final String programName;
  final String householdAddress;

  /// Mobile number, occupation, additional info: set or not.
  final List<SharedDetail> shared;

  SharedDetail? detail(String key) =>
      shared.where((d) => d.key == key).firstOrNull;
}

/// The roll's entry, as printed. The app never changes it.
class OfficialRecord {
  const OfficialRecord({
    this.name,
    this.relationType,
    this.relativeName,
    this.age,
    this.gender,
    this.houseNumber,
  });

  final String? name;
  final String? relationType;
  final String? relativeName;
  final int? age;
  final String? gender;
  final String? houseNumber;
}

/// A detail the voter may share and change.
class SharedDetail {
  const SharedDetail({
    required this.key,
    required this.labelKey,
    required this.value,
    required this.fieldValueId,
  });

  factory SharedDetail.fromJson(Map<String, dynamic> json) => SharedDetail(
    key: json['key'] as String,
    labelKey: json['labelKey'] as String,
    value: json['value'],
    fieldValueId: json['fieldValueId'] as String?,
  );

  final String key;
  final String labelKey;

  /// Null when not shared yet.
  final Object? value;

  /// The base for a change; null when not shared yet.
  final String? fieldValueId;

  bool get isSet => value != null && '$value'.trim().isNotEmpty;
}

/// A change to one shared detail: [baseVersion] is the value the app showed.
class DetailEdit {
  const DetailEdit({
    required this.key,
    required this.value,
    required this.baseVersion,
  });

  final String key;
  final Object value;
  final String? baseVersion;

  Map<String, Object?> toJson() => {
    'fieldKey': key,
    'value': value,
    'baseVersion': baseVersion,
  };
}

/// What happened to one detail: `applied`, `conflict` (someone changed it
/// meanwhile) or `rejected` (with the API's [code]).
class DetailResult {
  const DetailResult({required this.key, required this.status, this.code});

  factory DetailResult.fromJson(Map<String, dynamic> json) => DetailResult(
    key: json['fieldKey'] as String,
    status: json['status'] as String,
    code: json['code'] as String?,
  );

  final String key;
  final String status;
  final String? code;
}

/// Something that happened to the voter's record (`GET /v1/voter/me/updates`):
/// `detail` (a detail changed, by `you`, `volunteer` or `admin`; never the
/// value), `visit` (to their household, with its outcome) or `joined` (their
/// first sign-in). Unknown kinds are left out.
class VoterUpdate {
  const VoterUpdate({
    required this.kind,
    required this.at,
    this.fieldKey,
    this.by,
    this.outcome,
  });

  static VoterUpdate? fromJson(Map<String, dynamic> json) {
    final kind = json['kind'] as String;
    if (!const {'detail', 'visit', 'joined'}.contains(kind)) return null;
    return VoterUpdate(
      kind: kind,
      at: DateTime.parse(json['at'] as String),
      fieldKey: json['fieldKey'] as String?,
      by: json['by'] as String?,
      outcome: json['outcome'] as String?,
    );
  }

  final String kind;
  final DateTime at;
  final String? fieldKey;
  final String? by;
  final String? outcome;
}

/// One of the voter's consents (`GET /v1/voter/me/consents`, #225).
class VoterConsent {
  const VoterConsent({
    required this.id,
    required this.purpose,
    required this.status,
    required this.capturedAt,
    this.withdrawnAt,
  });

  factory VoterConsent.fromJson(Map<String, dynamic> json) => VoterConsent(
    id: json['id'] as String,
    purpose: json['purpose'] as String,
    status: json['status'] as String,
    capturedAt: DateTime.parse(json['capturedAt'] as String),
    withdrawnAt: switch (json['withdrawnAt']) {
      final String at => DateTime.parse(at),
      _ => null,
    },
  );

  final String id;

  /// The field key it covers, e.g. `caste_community`.
  final String purpose;

  /// `granted` or `withdrawn`.
  final String status;
  final DateTime capturedAt;
  final DateTime? withdrawnAt;

  bool get isGranted => status == 'granted';
}

/// The voter self-service API (#224, #225). Failures are [ApiError]s.
class VoterApi {
  VoterApi(this._dio);

  final Dio _dio;

  Future<VoterSelf> me() async {
    final response = await _call(
      () => _dio.get<Map<String, dynamic>>('/v1/voter/me'),
    );
    return VoterSelf.fromJson(response.data!);
  }

  /// Changes shared details (`PATCH /v1/voter/me/details`). Each gets its
  /// own result. Online only, so one idempotency key per save.
  Future<List<DetailResult>> editDetails(List<DetailEdit> edits) async {
    final response = await _call(
      () => _dio.patch<Map<String, dynamic>>(
        '/v1/voter/me/details',
        data: {
          'fields': [for (final e in edits) e.toJson()],
        },
        options: Options(headers: {'Idempotency-Key': newId()}),
      ),
    );
    return [
      for (final f in response.data!['fields'] as List<dynamic>)
        DetailResult.fromJson(f as Map<String, dynamic>),
    ];
  }

  /// What happened to the voter's record, newest first.
  Future<List<VoterUpdate>> updates() async {
    final response = await _call(
      () => _dio.get<Map<String, dynamic>>('/v1/voter/me/updates'),
    );
    return [
      for (final item in response.data!['items'] as List<dynamic>)
        ?VoterUpdate.fromJson(item as Map<String, dynamic>),
    ];
  }

  Future<List<VoterConsent>> consents() async {
    final response = await _call(
      () => _dio.get<Map<String, dynamic>>('/v1/voter/me/consents'),
    );
    return [
      for (final item in response.data!['items'] as List<dynamic>)
        VoterConsent.fromJson(item as Map<String, dynamic>),
    ];
  }

  /// Stops sharing what consent [id] covers. Withdrawing twice is harmless.
  Future<VoterConsent> withdrawConsent(String id) async {
    final response = await _call(
      () => _dio.post<Map<String, dynamic>>(
        '/v1/voter/me/consents/${Uri.encodeComponent(id)}/withdraw',
        options: Options(headers: {'Idempotency-Key': newId()}),
      ),
    );
    return VoterConsent.fromJson(response.data!);
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
