import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:boothconnect_mobile/data/api/api_client.dart';
import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/api/auth_api.dart';
import 'package:boothconnect_mobile/data/api/token_store.dart';
import 'package:boothconnect_mobile/data/api/voter_api.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/memory_secrets.dart';

/// A reply from the fake server; status 0 means no connection.
typedef Reply = (int status, Object? body);

/// Answers requests from a script instead of the network.
class FakeServer implements HttpClientAdapter {
  FakeServer(this.handle);

  Future<Reply> Function(RequestOptions request) handle;
  final requests = <RequestOptions>[];

  List<RequestOptions> to(String path) =>
      requests.where((r) => r.path == path).toList();

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final (status, body) = await handle(options);
    if (status == 0) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'offline',
      );
    }
    return ResponseBody.fromString(
      body == null ? '' : jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, Object> tokenPair(String n) => {
  'accessToken': 'access-$n',
  'refreshToken': 'refresh-$n',
  'tokenType': 'Bearer',
  'expiresIn': 900,
};

Map<String, Object> apiError(String code) => {
  'requestId': 'req-1',
  'code': code,
  'message': code,
};

void main() {
  late MemorySecrets secrets;
  late TokenStore tokens;
  late FakeServer server;
  late Dio dio;
  late int sessionEnded;

  setUp(() async {
    secrets = MemorySecrets();
    tokens = TokenStore(secrets);
    sessionEnded = 0;
    server = FakeServer((_) async => (200, {'ok': true}));
    dio = createApiDio(
      baseUrl: 'http://api.test',
      tokens: tokens,
      onSessionEnded: () => sessionEnded++,
      adapter: server,
    );
  });

  /// The server accepts only `access-<valid>`, and refreshes to [next].
  void acceptOnly(String valid, {String next = '2', Reply? refreshReply}) {
    server.handle = (r) async {
      if (r.path == '/v1/auth/refresh') {
        return refreshReply ?? (200, tokenPair(next));
      }
      return r.headers['authorization'] == 'Bearer access-$valid'
          ? (200, {'ok': true})
          : (401, apiError('UNAUTHENTICATED'));
    };
  }

  test('every request carries a request id the API accepts', () async {
    await dio.get<void>('/v1/health');
    await dio.get<void>('/v1/health');
    final ids = server.requests
        .map((r) => r.headers['x-request-id'] as String)
        .toList();
    for (final id in ids) {
      expect(id, matches(RegExp(r'^[0-9a-f]{32}$')));
    }
    expect(ids.toSet(), hasLength(2));
  });

  test('the access token goes with each call, except sign-in calls', () async {
    await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
    await dio.get<void>('/v1/me');
    await dio.post<void>(
      '/v1/auth/otp/request',
      options: Options(extra: noAuth),
    );
    expect(server.requests[0].headers['authorization'], 'Bearer access-1');
    expect(server.requests[1].headers.containsKey('authorization'), isFalse);
  });

  test('a 401 renews the tokens once and retries', () async {
    await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
    acceptOnly('2');

    final response = await dio.get<Map<String, dynamic>>('/v1/me');
    expect(response.data, {'ok': true});

    final refresh = server.to('/v1/auth/refresh').single;
    expect(refresh.data, {'refreshToken': 'refresh-1'});
    expect(refresh.headers.containsKey('authorization'), isFalse);
    expect(refresh.headers['x-request-id'], isNotNull);
    expect(
      server.to('/v1/me').last.headers['authorization'],
      'Bearer access-2',
    );
    // The rotated pair is kept, in memory and in secure storage.
    expect((await tokens.read())!.refresh, 'refresh-2');
    expect(secrets.values[TokenStore.refreshName], 'refresh-2');
    expect(sessionEnded, 0);
  });

  test('401s at the same time share one refresh', () async {
    await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
    acceptOnly('2');
    final results = await Future.wait([
      for (var i = 0; i < 3; i++) dio.get<Map<String, dynamic>>('/v1/me'),
    ]);
    expect(results.map((r) => r.statusCode), [200, 200, 200]);
    // A second refresh with the rotated-away token would revoke the session.
    expect(server.to('/v1/auth/refresh'), hasLength(1));
  });

  test('a 401 that arrives after another refresh reuses its tokens', () async {
    await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
    // Request "slow" was sent with access-1, but its 401 comes back only
    // after request "fast" has already refreshed the tokens.
    final refreshed = Completer<void>();
    server.handle = (r) async {
      if (r.path == '/v1/auth/refresh') {
        return (200, tokenPair('${server.to('/v1/auth/refresh').length + 1}'));
      }
      if (r.headers['authorization'] == 'Bearer access-2') {
        return (200, {'ok': true});
      }
      if (r.path == '/v1/slow') await refreshed.future;
      return (401, apiError('UNAUTHENTICATED'));
    };
    final slow = dio.get<Map<String, dynamic>>('/v1/slow');
    await dio.get<void>('/v1/fast');
    refreshed.complete();
    expect((await slow).statusCode, 200);
    // One refresh: a second, with the rotated-away token, would end the
    // session on the server.
    expect(server.to('/v1/auth/refresh'), hasLength(1));
    expect(
      server.to('/v1/slow').last.headers['authorization'],
      'Bearer access-2',
    );
  });

  test('a refused refresh ends the session', () async {
    await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
    acceptOnly('2', refreshReply: (401, apiError('UNAUTHENTICATED')));

    await expectLater(
      dio.get<void>('/v1/me'),
      throwsA(
        isA<DioException>().having(
          (e) => e.response?.statusCode,
          'status',
          401,
        ),
      ),
    );
    expect(sessionEnded, 1);
    expect(await tokens.read(), isNull);
    expect(secrets.values.containsKey(TokenStore.accessName), isFalse);
  });

  test('offline during the refresh keeps the session', () async {
    await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
    acceptOnly('2', refreshReply: (0, null));

    await expectLater(dio.get<void>('/v1/me'), throwsA(isA<DioException>()));
    expect(sessionEnded, 0);
    expect((await tokens.read())!.refresh, 'refresh-1');
  });

  test('a retried request that fails again is not retried again', () async {
    await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
    acceptOnly('never');
    await expectLater(dio.get<void>('/v1/me'), throwsA(isA<DioException>()));
    expect(server.to('/v1/auth/refresh'), hasLength(1));
    expect(server.to('/v1/me'), hasLength(2));
  });

  test('without tokens, a 401 ends the session without a refresh', () async {
    acceptOnly('1');
    await expectLater(dio.get<void>('/v1/me'), throwsA(isA<DioException>()));
    expect(server.to('/v1/auth/refresh'), isEmpty);
    expect(sessionEnded, 1);
  });

  group('AuthApi', () {
    late AuthApi api;

    setUp(() => api = AuthApi(dio, tokens));

    test(
      'sign-in: request, verify with a stable device id, keep the tokens',
      () async {
        server.handle = (r) async => switch (r.path) {
          '/v1/auth/otp/verify' => (200, tokenPair('1')),
          _ => (202, null),
        };
        await api.requestOtp('+919876543210');
        await api.verifyOtp('+919876543210', '123456');
        await api.verifyOtp('+919876543210', '123456');

        expect(server.to('/v1/auth/otp/request').single.data, {
          'phone': '+919876543210',
        });
        final verifies = server.to('/v1/auth/otp/verify');
        final first = verifies[0].data as Map<String, dynamic>;
        expect(first['phone'], '+919876543210');
        expect(first['code'], '123456');
        expect(first['deviceId'], matches(RegExp(r'^[0-9a-f]{32}$')));
        expect((verifies[1].data as Map)['deviceId'], first['deviceId']);
        expect(await api.hasSession(), isTrue);
        expect((await tokens.read())!.access, 'access-1');
      },
    );

    test('a wrong code is an OTP_INVALID error, with no refresh', () async {
      server.handle = (r) async => (401, apiError('OTP_INVALID'));
      await expectLater(
        api.verifyOtp('+919876543210', '000000'),
        throwsA(
          isA<ApiError>()
              .having((e) => e.code, 'code', 'OTP_INVALID')
              .having((e) => e.status, 'status', 401),
        ),
      );
      expect(server.to('/v1/auth/refresh'), isEmpty);
      expect(sessionEnded, 0);
      expect(await api.hasSession(), isFalse);
    });

    test('offline is a NETWORK error', () async {
      server.handle = (r) async => (0, null);
      await expectLater(
        api.requestOtp('+919876543210'),
        throwsA(isA<ApiError>().having((e) => e.isNetwork, 'isNetwork', true)),
      );
    });

    test('an answer that isn’t the API’s error body', () async {
      server.handle = (r) async => (502, 'Bad gateway');
      await expectLater(
        api.requestOtp('+919876543210'),
        throwsA(
          isA<ApiError>().having((e) => e.code, 'code', 'INTERNAL_ERROR'),
        ),
      );
    });

    test('/v1/me: a volunteer or not', () async {
      Map<String, Object?> assignment(String role) => {
        'id': 'ra-1',
        'role': role,
        'validFrom': '2026-01-01T00:00:00.000Z',
        'validUntil': null,
        'node': {
          'id': 'n-1',
          'type': 'polling_station',
          'code': '1',
          'name': 'Demo Primary School',
          'isAuxiliary': false,
        },
        'path': <Object>[],
      };
      Map<String, Object?> me(List<String> roles) => {
        'id': 'u-1',
        'name': 'Test Volunteer',
        'phone': '+919999900002',
        'email': null,
        'preferredLanguage': 'en',
        'mfaState': 'not_enrolled',
        'assignments': [for (final r in roles) assignment(r)],
      };
      server.handle = (r) async => (200, me(['volunteer']));
      final volunteer = await api.me();
      expect(volunteer.name, 'Test Volunteer');
      expect(volunteer.assignments.single.nodeName, 'Demo Primary School');
      expect(volunteer.isVolunteer, isTrue);

      server.handle = (r) async => (200, me(['admin']));
      expect((await api.me()).isVolunteer, isFalse);
      server.handle = (r) async => (200, me([]));
      expect((await api.me()).isVolunteer, isFalse);
    });

    test(
      'a voter signs in with EPIC and phone; the session is a voter’s (#226)',
      () async {
        server.handle = (r) async => switch (r.path) {
          '/v1/voter-auth/otp/verify' => (200, tokenPair('v')),
          _ => (202, null),
        };
        await api.requestVoterOtp('SYN1000001', '+919999900101');
        expect(server.to('/v1/voter-auth/otp/request').single.data, {
          'epic': 'SYN1000001',
          'phone': '+919999900101',
        });
        // No token goes with the sign-in calls.
        expect(
          server
              .to('/v1/voter-auth/otp/request')
              .single
              .headers['authorization'],
          isNull,
        );
        expect(await api.isVoterSession(), isFalse);

        await api.verifyVoterOtp('SYN1000001', '+919999900101', '123456');
        final body =
            server.to('/v1/voter-auth/otp/verify').single.data
                as Map<String, dynamic>;
        expect(body['epic'], 'SYN1000001');
        expect(body['code'], '123456');
        expect(body['deviceId'], matches(RegExp(r'^[0-9a-f]{32}$')));
        expect((await tokens.read())!.access, 'access-v');
        expect(await api.isVoterSession(), isTrue);

        // A volunteer's sign-in afterwards: a volunteer's session again.
        server.handle = (r) async => (200, tokenPair('2'));
        await api.verifyOtp('+919876543210', '123456');
        expect(await api.isVoterSession(), isFalse);

        // Signing out forgets whose session it was.
        await api.verifyVoterOtp('SYN1000001', '+919999900101', '123456');
        server.handle = (r) async => (204, null);
        await api.logout();
        expect(await api.isVoterSession(), isFalse);
        expect(secrets.values.containsKey(TokenStore.kindName), isFalse);
      },
    );

    test('/v1/me for a voter, and the voter’s record', () async {
      server.handle = (r) async => switch (r.path) {
        '/v1/me' => (
          200,
          {
            'id': 'u-2',
            'name': 'Synthetic Voter',
            'phone': '+919999900101',
            'email': null,
            'preferredLanguage': 'en',
            'mfaState': 'not_enrolled',
            'assignments': <Object>[],
            'voter': {'id': 'v-1'},
          },
        ),
        '/v1/voter/me' => (
          200,
          {
            'id': 'v-1',
            'epicNumber': 'SYN1000001',
            'official': {
              'name': 'Synthetic Lakshmi',
              'relationType': 'husband',
              'relativeName': 'Synthetic Ravi',
              'age': 46,
              'gender': 'female',
              'houseNumber': '1-3',
            },
            'sectionNo': 1,
            'serialNo': 217,
            'part': {'code': '408', 'name': 'Demo Nagar'},
            'booth': {'code': '142', 'name': 'Demo Primary School'},
            'program': {'name': 'Demo General Election 2026'},
            'household': {'address': 'H NO 1-3'},
            'shared': [
              {
                'key': 'mobile_number',
                'labelKey': 'field.mobile_number',
                'value': '+919999900101',
                'fieldValueId': 'fv-1',
                'collectedAt': '2026-09-01T00:00:00.000Z',
              },
              {
                'key': 'occupation',
                'labelKey': 'field.occupation',
                'value': null,
                'fieldValueId': null,
                'collectedAt': null,
              },
            ],
          },
        ),
        _ => (404, apiError('NOT_FOUND')),
      };
      final me = await api.me();
      expect((me.isVoter, me.voterId, me.isVolunteer), (true, 'v-1', false));

      final self = await VoterApi(dio).me();
      expect(self.official.name, 'Synthetic Lakshmi');
      expect(self.official.age, 46);
      expect(
        (self.boothCode, self.partName, self.serialNo),
        ('142', 'Demo Nagar', 217),
      );
      expect(self.detail('mobile_number')!.isSet, isTrue);
      expect(self.detail('occupation')!.isSet, isFalse);
      expect(self.detail('occupation')!.fieldValueId, isNull);
    });

    test('logout forgets the tokens, even offline', () async {
      await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
      server.handle = (r) async => (0, null);
      await api.logout();
      expect(await api.hasSession(), isFalse);
      expect(secrets.values.containsKey(TokenStore.refreshName), isFalse);
    });

    test('logout tells the server when it can', () async {
      await tokens.save(const Tokens(access: 'access-1', refresh: 'refresh-1'));
      server.handle = (r) async => (204, null);
      await api.logout();
      expect(
        server.to('/v1/auth/logout').single.headers['authorization'],
        'Bearer access-1',
      );
    });
  });

  test('the device id stays across sign-outs', () async {
    final id = await tokens.deviceId();
    await tokens.clear();
    expect(await tokens.deviceId(), id);
    expect(await TokenStore(MemorySecrets()).deviceId(), isNot(id));
  });
}
