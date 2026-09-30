import 'package:boothconnect_mobile/data/api/api_error.dart';
import 'package:boothconnect_mobile/data/sync/sync_api.dart';

/// A sync page with nothing in it; tests add what they need.
Map<String, dynamic> syncPage({
  required String cursor,
  bool reset = false,
  bool hasMore = false,
  List<Map<String, dynamic>> fieldDefinitions = const [],
  List<Map<String, dynamic>> households = const [],
  List<Map<String, dynamic>> voters = const [],
  List<Map<String, dynamic>> fieldValues = const [],
  List<Map<String, dynamic>> visits = const [],
  List<String> removedFieldValueIds = const [],
}) => {
  'reset': reset,
  'fieldDefinitions': fieldDefinitions,
  'households': households,
  'voters': voters,
  'fieldValues': fieldValues,
  'visits': visits,
  'removedFieldValueIds': removedFieldValueIds,
  'conflicts': <Object>[],
  'hasMore': hasMore,
  'cursor': cursor,
};

/// [SyncApi] without a server: answers from [pages] in order (an
/// [ApiError] in the list is thrown), then an empty page.
class FakeSyncApi implements SyncApi {
  FakeSyncApi([List<Object>? pages]) : pages = pages ?? [];

  final List<Object> pages;

  /// The `since` of every call, in order.
  final calls = <String?>[];

  @override
  Future<Map<String, dynamic>> pull({String? since, int? limit}) async {
    calls.add(since);
    if (pages.isEmpty) {
      return syncPage(cursor: since ?? 'c-empty', reset: since == null);
    }
    final next = pages.removeAt(0);
    if (next is ApiError) throw next;
    return next as Map<String, dynamic>;
  }

  /// Push failures to throw, one per call, before answering normally.
  final pushErrors = <ApiError>[];

  /// Every batch sent, in order.
  final pushed = <List<Map<String, Object?>>>[];

  /// What the server stored, by key: a key sent again is a `duplicate`.
  final stored = <String, Map<String, dynamic>>{};

  /// The answer for a change the server hasn't seen; by default `applied`,
  /// with server ids made from the key.
  Map<String, dynamic> Function(Map<String, Object?> mutation) answer = applied;

  static Map<String, dynamic> applied(Map<String, Object?> m) => {
    'status': 'applied',
    'result': {
      'id': 'server-${m['key']}',
      'fieldValueId': 'server-fv-${m['key']}',
    },
  };

  @override
  Future<List<Map<String, dynamic>>> push(
    List<Map<String, Object?>> mutations,
  ) async {
    pushed.add(mutations);
    if (pushErrors.isNotEmpty) throw pushErrors.removeAt(0);
    return [
      for (final m in mutations)
        {
          'key': m['key'],
          'type': m['type'],
          ...stored.containsKey(m['key'])
              ? {'status': 'duplicate', 'result': stored[m['key']]!['result']}
              : _store(m),
        },
    ];
  }

  Map<String, dynamic> _store(Map<String, Object?> m) {
    final result = answer(m);
    if (result['status'] != 'rejected') stored[m['key']! as String] = result;
    return result;
  }
}

const offline = ApiError(ApiError.network);
