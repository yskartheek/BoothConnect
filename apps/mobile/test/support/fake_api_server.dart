import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'fake_auth_api.dart' show goodCode;

// Synthetic data only.

/// A stand-in for the BoothConnect API over real HTTP, on localhost: the
/// endpoints the app uses to sign in, download its booth and upload its
/// changes, with the API's rules that matter offline (a request's
/// Idempotency-Key, each change stored once by its key).
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
    final body = request.method == 'POST'
        ? await utf8.decoder.bind(request).join()
        : '';
    Map<String, dynamic> json() =>
        body.isEmpty ? {} : jsonDecode(body) as Map<String, dynamic>;

    final open = path.startsWith('/v1/auth/otp/');
    if (!open && request.headers.value('authorization') != 'Bearer $token') {
      return _send(request, 401, {'code': 'UNAUTHENTICATED'});
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
    'fieldValues': <Object>[],
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
