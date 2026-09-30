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
}

const offline = ApiError(ApiError.network);
