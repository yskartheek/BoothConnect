import 'dart:convert';

import 'package:drift/drift.dart';

// The phone's copy of the volunteer's booths, as `GET /v1/sync/pull` sends
// it (see the API's `SyncPage`), plus the changes waiting to be pushed.
// JSON values from the API are stored as JSON text.

/// A list of strings stored as a JSON array.
class StringListConverter extends TypeConverter<List<String>, String> {
  const StringListConverter();

  @override
  List<String> fromSql(String fromDb) =>
      (jsonDecode(fromDb) as List<dynamic>).cast<String>();

  @override
  String toSql(List<String> value) => jsonEncode(value);
}

/// The fields collected on households and voters (`SyncFieldDefinition`).
@DataClassName('FieldDefinitionRow')
class FieldDefinitions extends Table {
  @override
  String get tableName => 'field_definitions';

  TextColumn get id => text()();
  TextColumn get key => text()();
  TextColumn get labelKey => text()();

  /// `household` or `voter`.
  TextColumn get appliesTo => text()();
  TextColumn get type => text()();

  /// JSON: the choices of a select field, or null.
  TextColumn get options => text().nullable()();
  BoolColumn get isRestricted => boolean()();
  BoolColumn get requiresConsent => boolean()();

  /// False: no longer collected; hide the field and its values.
  BoolColumn get enabled => boolean()();
  TextColumn get purpose => text()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('HouseholdRow')
@TableIndex(name: 'households_station', columns: {#pollingStationId})
class Households extends Table {
  @override
  String get tableName => 'households';

  TextColumn get id => text()();
  TextColumn get partId => text()();
  TextColumn get pollingStationId => text()();
  TextColumn get displayAddress => text()();
  TextColumn get houseKey => text()();

  /// JSON.
  TextColumn get structuredAddress => text().nullable()();
  RealColumn get latitude => real().nullable()();
  RealColumn get longitude => real().nullable()();
  RealColumn get accuracyM => real().nullable()();
  DateTimeColumn get locationCapturedAt => dateTime().nullable()();
  TextColumn get origin => text()();

  /// `removed`: no longer in the roll.
  TextColumn get status => text()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('VoterRow')
@TableIndex(name: 'voters_household', columns: {#householdId})
class Voters extends Table {
  @override
  String get tableName => 'voters';

  TextColumn get id => text()();
  TextColumn get householdId => text()();
  TextColumn get partId => text()();
  TextColumn get pollingStationId => text()();
  TextColumn get origin => text()();

  /// Anything but `active`: not shown in the household.
  TextColumn get recordStatus => text()();
  IntColumn get sectionNo => integer().nullable()();
  IntColumn get serialNo => integer().nullable()();
  TextColumn get epicNumber => text().nullable()();

  /// JSON: the roll's values (name, age, gender, relation, house number).
  TextColumn get official => text()();

  /// Earlier records of this voter that newer rolls replaced.
  TextColumn get previousVoterIds => text().map(const StringListConverter())();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('FieldValueRow')
@TableIndex(name: 'field_values_entity', columns: {#entityId, #fieldKey})
class FieldValues extends Table {
  @override
  String get tableName => 'field_values';

  TextColumn get id => text()();

  /// `household` or `voter`.
  TextColumn get entityType => text()();
  TextColumn get entityId => text()();
  TextColumn get fieldKey => text()();

  /// JSON.
  TextColumn get value => text()();
  TextColumn get sourceType => text()();
  TextColumn get collectedById => text().nullable()();
  TextColumn get collectedByName => text().nullable()();
  DateTimeColumn get collectedAt => dateTime()();
  TextColumn get supersedesId => text().nullable()();
  TextColumn get carriedFromId => text().nullable()();
  BoolColumn get isCurrent => boolean()();
  TextColumn get conflictWithId => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Visits, keyed by the phone's `clientId`: a visit recorded offline has no
/// server id until it is pushed.
@DataClassName('VisitRow')
@TableIndex(name: 'visits_household', columns: {#householdId})
class Visits extends Table {
  @override
  String get tableName => 'visits';

  TextColumn get clientId => text()();
  TextColumn get serverId => text().nullable().unique()();
  TextColumn get householdId => text()();
  TextColumn get volunteerId => text()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get completedAt => dateTime().nullable()();
  TextColumn get outcome => text()();
  TextColumn get formVersion => text()();
  TextColumn get notes => text().nullable()();
  TextColumn get correctsVisitId => text().nullable()();
  TextColumn get memberIdsMet => text().map(const StringListConverter())();

  @override
  Set<Column<Object>> get primaryKey => {clientId};
}

/// Sync bookkeeping, e.g. `cursor`: the last pull's cursor.
@DataClassName('SyncMetaRow')
class SyncMeta extends Table {
  @override
  String get tableName => 'sync_meta';

  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

/// A change made on the phone, waiting for `POST /v1/sync/push`, oldest
/// first. The sync worker (#66) sends, retries and clears these.
@DataClassName('PendingMutationRow')
@TableIndex(name: 'pending_mutation_status', columns: {#status})
@TableIndex(name: 'pending_mutation_household', columns: {#householdId})
class PendingMutations extends Table {
  @override
  String get tableName => 'pending_mutation';

  /// Push order.
  IntColumn get id => integer().autoIncrement()();

  /// The idempotency key sent with it: the same change is never applied
  /// twice, however often it is retried.
  TextColumn get key => text().unique()();

  /// `field.change`, `visit.create`, … (the API's mutation types).
  TextColumn get type => text()();

  /// The household the change is about (for a member, their household), so
  /// the households list can show it as "On phone" (schema version 2).
  TextColumn get householdId => text().nullable()();

  /// JSON.
  TextColumn get payload => text()();

  /// `pending`, `syncing`, `conflict` or `failed`.
  TextColumn get status => text().withDefault(const Constant('pending'))();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get nextAttemptAt => dateTime().nullable()();

  /// An API error code, never the payload.
  TextColumn get lastError => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
}
