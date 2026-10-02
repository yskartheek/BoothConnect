import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'fake_auth_api.dart' show goodCode;

// Synthetic data only.

/// A stand-in for the BoothConnect API over real HTTP, on localhost: the
/// endpoints the app uses to sign in, download its booth and upload its
/// changes, with the API's rules that matter offline (a request's
/// Idempotency-Key, each change stored once by its key). The voter side
/// (#229): voter sign-in, their record, editing what they share (a stale
/// base is a conflict) and Updates; their edits reach the volunteer's pull.
class FakeApiServer {
  FakeApiServer._(this._server);

  static Future<FakeApiServer> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final api = FakeApiServer._(server);
    server.listen(api._handle);
    return api;
  }

  final HttpServer _server;

  String get baseUrl => 'http://${_server.address.host}:${_server.port}';

  /// Down: every connection is dropped, as with no network.
  var down = false;

  static const token = 'synthetic-access-token';
  static const voterToken = 'synthetic-voter-access-token';

  /// The voter who can sign in: Synthetic Lakshmi, the household's first
  /// member.
  static const voterEpic = 'SYN1000001';
  static const voterPhone = '+919999900101';
  static const voterId = '0190a000-0000-7000-8000-000000000101';

  /// What the voter shares, by key: the current value and its id.
  final shared = <String, ({Object? value, String? id})>{
    'mobile_number': (value: voterPhone, id: 'fv-mobile-1'),
    'occupation': (value: 'Teacher', id: 'fv-occupation-1'),
    'additional_info': (value: null, id: null),
  };

  /// The voter's changes, oldest first: (field key, value id, when).
  final voterEdits = <(String, String, DateTime)>[];

  /// Each voter edit request's Idempotency-Key.
  final editKeys = <String?>[];

  /// The one booth: a household with two members.
  static const householdId = '0190a000-0000-7000-8000-000000000001';
  static const address = '12/4 Synthetic Road';

  /// Visits stored, by client id (`visit.create` once per key).
  final visits = <String, Map<String, dynamic>>{};

  /// Each push request: its Idempotency-Key and the change keys it carried.
  final pushes = <(String?, List<String>)>[];

  final _stored = <String, Map<String, dynamic>>{};
  var _visitSeq = 0;

  Future<void> close() => _server.close(force: true);

  Future<void> _handle(HttpRequest request) async {
    if (down) {
      // No answer at all: the phone sees a network error.
      final socket = await request.response.detachSocket(writeHeaders: false);
      socket.destroy();
      return;
    }
    final path = request.uri.path;
    final body = request.method == 'POST' || request.method == 'PATCH'
        ? await utf8.decoder.bind(request).join()
        : '';
    Map<String, dynamic> json() =>
        body.isEmpty ? {} : jsonDecode(body) as Map<String, dynamic>;

    final open =
        path.startsWith('/v1/auth/otp/') ||
        path.startsWith('/v1/voter-auth/otp/');
    final auth = request.headers.value('authorization');
    final asVoter = auth == 'Bearer $voterToken';
    if (!open && auth != 'Bearer $token' && !asVoter) {
      return _send(request, 401, {'code': 'UNAUTHENTICATED'});
    }
    // Each side's endpoints are closed to the other.
    if (!open &&
        asVoter != path.startsWith('/v1/voter/') &&
        path != '/v1/me' &&
        path != '/v1/auth/logout') {
      return _send(request, 403, {'code': 'FORBIDDEN'});
    }
    switch ((request.method, path)) {
      case ('POST', '/v1/auth/otp/request'):
        return _send(request, 202, {'sent': true});
      case ('POST', '/v1/auth/otp/verify'):
        if (json()['code'] != goodCode) {
          return _send(request, 401, {'code': 'OTP_INVALID'});
        }
        return _send(request, 200, {
          'accessToken': token,
          'refreshToken': 'synthetic-refresh-token',
        });
      case ('POST', '/v1/auth/logout'):
        return _send(request, 204, null);
      case ('POST', '/v1/voter-auth/otp/request'):
        return _send(request, 202, {'sent': true});
      case ('POST', '/v1/voter-auth/otp/verify'):
        final b = json();
        if (b['code'] != goodCode ||
            b['epic'] != voterEpic ||
            b['phone'] != voterPhone) {
          return _send(request, 401, {'code': 'OTP_INVALID'});
        }
        voterSignedInAt ??= DateTime.now().toUtc();
        return _send(request, 200, {
          'accessToken': voterToken,
          'refreshToken': 'synthetic-voter-refresh-token',
        });
      case ('GET', '/v1/me') when asVoter:
        return _send(request, 200, {
          'id': 'u-synthetic-voter',
          'name': 'Synthetic Lakshmi',
          'assignments': <Object>[],
          'voter': {'id': voterId},
        });
      case ('GET', '/v1/voter/me'):
        return _send(request, 200, _voterSelf());
      case ('PATCH', '/v1/voter/me/details'):
        return _editDetails(request, json());
      case ('GET', '/v1/voter/me/consents'):
        return _send(request, 200, {'items': <Object>[]});
      case ('GET', '/v1/voter/me/updates'):
        return _send(request, 200, {
          'items': [
            for (final (key, _, at) in voterEdits.reversed)
              {
                'kind': 'detail',
                'fieldKey': key,
                'labelKey': 'field.$key',
                'by': 'you',
                'at': at.toIso8601String(),
              },
            if (voterSignedInAt case final at?)
              {'kind': 'joined', 'at': at.toIso8601String()},
          ],
        });
      case ('GET', '/v1/me'):
        return _send(request, 200, {
          'id': 'u-synthetic-volunteer',
          'name': 'Synthetic Volunteer',
          'assignments': [
            {
              'role': 'volunteer',
              'node': {
                'type': 'polling_station',
                'name': 'Synthetic Primary School',
                'code': '1',
              },
            },
          ],
        });
      case ('GET', '/v1/sync/pull'):
        return _send(request, 200, _page(request.uri.queryParameters['since']));
      case ('POST', '/v1/sync/push'):
        return _push(request, json());
    }
    return _send(request, 404, {'code': 'NOT_FOUND'});
  }

  /// When the voter first signed in.
  DateTime? voterSignedInAt;

  Map<String, dynamic> _voterSelf() => {
    'id': voterId,
    'epicNumber': voterEpic,
    'official': {
      'name': 'Synthetic Lakshmi',
      'relationType': 'husband',
      'relativeName': 'Synthetic Ravi',
      'age': 41,
      'gender': 'female',
      'houseNumber': '12/4',
    },
    'sectionNo': 1,
    'serialNo': 1,
    'part': {'code': '1', 'name': 'Synthetic Nagar'},
    'booth': {'code': '1', 'name': 'Synthetic Primary School'},
    'program': {'name': 'Synthetic Election'},
    'household': {'address': address},
    'shared': [
      for (final MapEntry(:key, value: v) in shared.entries)
        {
          'key': key,
          'labelKey': 'field.$key',
          'value': v.value,
          'fieldValueId': v.id,
          'collectedAt': null,
        },
    ],
  };

  Future<void> _editDetails(HttpRequest request, Map<String, dynamic> body) {
    final key = request.headers.value('idempotency-key');
    editKeys.add(key);
    if (key == null) {
      return _send(request, 400, {'code': 'IDEMPOTENCY_KEY_REQUIRED'});
    }
    final fields = [
      for (final f
          in (body['fields'] as List<dynamic>).cast<Map<String, dynamic>>())
        () {
          final fieldKey = f['fieldKey'] as String;
          final current = shared[fieldKey];
          if (current == null) {
            return {
              'fieldKey': fieldKey,
              'status': 'rejected',
              'code': 'FORBIDDEN',
            };
          }
          if (f['baseVersion'] != current.id) {
            return {'fieldKey': fieldKey, 'status': 'conflict'};
          }
          final id = 'fv-$fieldKey-${voterEdits.length + 2}';
          shared[fieldKey] = (value: f['value'], id: id);
          voterEdits.add((fieldKey, id, DateTime.now().toUtc()));
          return {'fieldKey': fieldKey, 'status': 'applied'};
        }(),
    ];
    return _send(request, 200, {'fields': fields});
  }

  Map<String, dynamic> _page(String? since) => {
    'reset': since == null,
    'fieldDefinitions': <Object>[],
    'households': [
      if (since == null)
        {
          'id': householdId,
          'partId': 'part-1',
          'pollingStationId': 'station-1',
          'displayAddress': address,
          'houseKey': '12/4',
          'structuredAddress': null,
          'location': null,
          'origin': 'official_import',
          'status': 'active',
        },
    ],
    'voters': [
      if (since == null)
        for (final (n, name) in [
          (1, 'Synthetic Lakshmi'),
          (2, 'Synthetic Arjun'),
        ])
          {
            'id': '0190a000-0000-7000-8000-00000000010$n',
            'householdId': householdId,
            'partId': 'part-1',
            'pollingStationId': 'station-1',
            'origin': 'official_import',
            'recordStatus': 'active',
            'sectionNo': 1,
            'serialNo': n,
            'epicNumber': null,
            'official': {'name': name, 'age': 40 + n},
            'previousVoterIds': <String>[],
          },
    ],
    // What the voter shared, as the voter's (#229).
    'fieldValues': [
      for (final (key, id, at) in voterEdits)
        if (shared[key]?.id == id)
          {
            'id': id,
            'entityType': 'voter',
            'entityId': voterId,
            'fieldKey': key,
            'value': shared[key]!.value,
            'sourceType': 'voter_self_submitted',
            'collectedBy': {
              'id': 'u-synthetic-voter',
              'name': 'Synthetic Lakshmi',
            },
            'collectedAt': at.toIso8601String(),
            'supersedesId': null,
            'carriedFromId': null,
            'isCurrent': true,
            'conflictWithId': null,
          },
    ],
    // What the phone uploaded comes back, as on the real API.
    'visits': visits.values.toList(),
    'removedFieldValueIds': <String>[],
    'conflicts': <Object>[],
    'hasMore': false,
    'cursor': 'c-${visits.length}',
  };

  Future<void> _push(HttpRequest request, Map<String, dynamic> body) {
    final key = request.headers.value('idempotency-key');
    if (key == null) {
      return _send(request, 400, {'code': 'IDEMPOTENCY_KEY_REQUIRED'});
    }
    final mutations = (body['mutations'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    pushes.add((key, [for (final m in mutations) m['key'] as String]));
    final results = <Map<String, dynamic>>[];
    for (final m in mutations) {
      final itemKey = m['key'] as String;
      final stored = _stored[itemKey];
      if (stored != null) {
        results.add({...stored, 'status': 'duplicate'});
        continue;
      }
      final Map<String, dynamic> result;
      if (m['type'] == 'visit.create') {
        final p = m['payload'] as Map<String, dynamic>;
        final visit = {
          'id':
              '0190b000-0000-7000-8000-${(++_visitSeq).toString().padLeft(12, '0')}',
          'clientId': p['clientId'],
          'householdId': p['householdId'],
          'volunteerId': 'u-synthetic-volunteer',
          'startedAt': p['startedAt'],
          'completedAt': p['completedAt'],
          'outcome': p['outcome'],
          'formVersion': p['formVersion'],
          'notes': p['notes'],
          'correctsVisitId': null,
          'memberIdsMet': p['memberIdsMet'] ?? <String>[],
        };
        visits[p['clientId'] as String] = visit;
        result = {
          'key': itemKey,
          'type': m['type'],
          'status': 'applied',
          'result': visit,
        };
      } else {
        result = {
          'key': itemKey,
          'type': m['type'],
          'status': 'rejected',
          'code': 'VALIDATION_FAILED',
        };
      }
      if (result['status'] != 'rejected') _stored[itemKey] = result;
      results.add(result);
    }
    return _send(request, 200, {'results': results});
  }

  Future<void> _send(HttpRequest request, int status, Object? body) async {
    request.response.statusCode = status;
    if (body != null) {
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode(body));
    }
    await request.response.close();
  }
}
