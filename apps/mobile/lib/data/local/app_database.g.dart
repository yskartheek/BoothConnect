// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $FieldDefinitionsTable extends FieldDefinitions
    with TableInfo<$FieldDefinitionsTable, FieldDefinitionRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldDefinitionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _labelKeyMeta = const VerificationMeta(
    'labelKey',
  );
  @override
  late final GeneratedColumn<String> labelKey = GeneratedColumn<String>(
    'label_key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _appliesToMeta = const VerificationMeta(
    'appliesTo',
  );
  @override
  late final GeneratedColumn<String> appliesTo = GeneratedColumn<String>(
    'applies_to',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _optionsMeta = const VerificationMeta(
    'options',
  );
  @override
  late final GeneratedColumn<String> options = GeneratedColumn<String>(
    'options',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isRestrictedMeta = const VerificationMeta(
    'isRestricted',
  );
  @override
  late final GeneratedColumn<bool> isRestricted = GeneratedColumn<bool>(
    'is_restricted',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_restricted" IN (0, 1))',
    ),
  );
  static const VerificationMeta _requiresConsentMeta = const VerificationMeta(
    'requiresConsent',
  );
  @override
  late final GeneratedColumn<bool> requiresConsent = GeneratedColumn<bool>(
    'requires_consent',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("requires_consent" IN (0, 1))',
    ),
  );
  static const VerificationMeta _enabledMeta = const VerificationMeta(
    'enabled',
  );
  @override
  late final GeneratedColumn<bool> enabled = GeneratedColumn<bool>(
    'enabled',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("enabled" IN (0, 1))',
    ),
  );
  static const VerificationMeta _purposeMeta = const VerificationMeta(
    'purpose',
  );
  @override
  late final GeneratedColumn<String> purpose = GeneratedColumn<String>(
    'purpose',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    key,
    labelKey,
    appliesTo,
    type,
    options,
    isRestricted,
    requiresConsent,
    enabled,
    purpose,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_definitions';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldDefinitionRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('label_key')) {
      context.handle(
        _labelKeyMeta,
        labelKey.isAcceptableOrUnknown(data['label_key']!, _labelKeyMeta),
      );
    } else if (isInserting) {
      context.missing(_labelKeyMeta);
    }
    if (data.containsKey('applies_to')) {
      context.handle(
        _appliesToMeta,
        appliesTo.isAcceptableOrUnknown(data['applies_to']!, _appliesToMeta),
      );
    } else if (isInserting) {
      context.missing(_appliesToMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('options')) {
      context.handle(
        _optionsMeta,
        options.isAcceptableOrUnknown(data['options']!, _optionsMeta),
      );
    }
    if (data.containsKey('is_restricted')) {
      context.handle(
        _isRestrictedMeta,
        isRestricted.isAcceptableOrUnknown(
          data['is_restricted']!,
          _isRestrictedMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_isRestrictedMeta);
    }
    if (data.containsKey('requires_consent')) {
      context.handle(
        _requiresConsentMeta,
        requiresConsent.isAcceptableOrUnknown(
          data['requires_consent']!,
          _requiresConsentMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_requiresConsentMeta);
    }
    if (data.containsKey('enabled')) {
      context.handle(
        _enabledMeta,
        enabled.isAcceptableOrUnknown(data['enabled']!, _enabledMeta),
      );
    } else if (isInserting) {
      context.missing(_enabledMeta);
    }
    if (data.containsKey('purpose')) {
      context.handle(
        _purposeMeta,
        purpose.isAcceptableOrUnknown(data['purpose']!, _purposeMeta),
      );
    } else if (isInserting) {
      context.missing(_purposeMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  FieldDefinitionRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldDefinitionRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      labelKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}label_key'],
      )!,
      appliesTo: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}applies_to'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      options: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}options'],
      ),
      isRestricted: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_restricted'],
      )!,
      requiresConsent: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}requires_consent'],
      )!,
      enabled: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}enabled'],
      )!,
      purpose: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}purpose'],
      )!,
    );
  }

  @override
  $FieldDefinitionsTable createAlias(String alias) {
    return $FieldDefinitionsTable(attachedDatabase, alias);
  }
}

class FieldDefinitionRow extends DataClass
    implements Insertable<FieldDefinitionRow> {
  final String id;
  final String key;
  final String labelKey;

  /// `household` or `voter`.
  final String appliesTo;
  final String type;

  /// JSON: the choices of a select field, or null.
  final String? options;
  final bool isRestricted;
  final bool requiresConsent;

  /// False: no longer collected; hide the field and its values.
  final bool enabled;
  final String purpose;
  const FieldDefinitionRow({
    required this.id,
    required this.key,
    required this.labelKey,
    required this.appliesTo,
    required this.type,
    this.options,
    required this.isRestricted,
    required this.requiresConsent,
    required this.enabled,
    required this.purpose,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['key'] = Variable<String>(key);
    map['label_key'] = Variable<String>(labelKey);
    map['applies_to'] = Variable<String>(appliesTo);
    map['type'] = Variable<String>(type);
    if (!nullToAbsent || options != null) {
      map['options'] = Variable<String>(options);
    }
    map['is_restricted'] = Variable<bool>(isRestricted);
    map['requires_consent'] = Variable<bool>(requiresConsent);
    map['enabled'] = Variable<bool>(enabled);
    map['purpose'] = Variable<String>(purpose);
    return map;
  }

  FieldDefinitionsCompanion toCompanion(bool nullToAbsent) {
    return FieldDefinitionsCompanion(
      id: Value(id),
      key: Value(key),
      labelKey: Value(labelKey),
      appliesTo: Value(appliesTo),
      type: Value(type),
      options: options == null && nullToAbsent
          ? const Value.absent()
          : Value(options),
      isRestricted: Value(isRestricted),
      requiresConsent: Value(requiresConsent),
      enabled: Value(enabled),
      purpose: Value(purpose),
    );
  }

  factory FieldDefinitionRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldDefinitionRow(
      id: serializer.fromJson<String>(json['id']),
      key: serializer.fromJson<String>(json['key']),
      labelKey: serializer.fromJson<String>(json['labelKey']),
      appliesTo: serializer.fromJson<String>(json['appliesTo']),
      type: serializer.fromJson<String>(json['type']),
      options: serializer.fromJson<String?>(json['options']),
      isRestricted: serializer.fromJson<bool>(json['isRestricted']),
      requiresConsent: serializer.fromJson<bool>(json['requiresConsent']),
      enabled: serializer.fromJson<bool>(json['enabled']),
      purpose: serializer.fromJson<String>(json['purpose']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'key': serializer.toJson<String>(key),
      'labelKey': serializer.toJson<String>(labelKey),
      'appliesTo': serializer.toJson<String>(appliesTo),
      'type': serializer.toJson<String>(type),
      'options': serializer.toJson<String?>(options),
      'isRestricted': serializer.toJson<bool>(isRestricted),
      'requiresConsent': serializer.toJson<bool>(requiresConsent),
      'enabled': serializer.toJson<bool>(enabled),
      'purpose': serializer.toJson<String>(purpose),
    };
  }

  FieldDefinitionRow copyWith({
    String? id,
    String? key,
    String? labelKey,
    String? appliesTo,
    String? type,
    Value<String?> options = const Value.absent(),
    bool? isRestricted,
    bool? requiresConsent,
    bool? enabled,
    String? purpose,
  }) => FieldDefinitionRow(
    id: id ?? this.id,
    key: key ?? this.key,
    labelKey: labelKey ?? this.labelKey,
    appliesTo: appliesTo ?? this.appliesTo,
    type: type ?? this.type,
    options: options.present ? options.value : this.options,
    isRestricted: isRestricted ?? this.isRestricted,
    requiresConsent: requiresConsent ?? this.requiresConsent,
    enabled: enabled ?? this.enabled,
    purpose: purpose ?? this.purpose,
  );
  FieldDefinitionRow copyWithCompanion(FieldDefinitionsCompanion data) {
    return FieldDefinitionRow(
      id: data.id.present ? data.id.value : this.id,
      key: data.key.present ? data.key.value : this.key,
      labelKey: data.labelKey.present ? data.labelKey.value : this.labelKey,
      appliesTo: data.appliesTo.present ? data.appliesTo.value : this.appliesTo,
      type: data.type.present ? data.type.value : this.type,
      options: data.options.present ? data.options.value : this.options,
      isRestricted: data.isRestricted.present
          ? data.isRestricted.value
          : this.isRestricted,
      requiresConsent: data.requiresConsent.present
          ? data.requiresConsent.value
          : this.requiresConsent,
      enabled: data.enabled.present ? data.enabled.value : this.enabled,
      purpose: data.purpose.present ? data.purpose.value : this.purpose,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldDefinitionRow(')
          ..write('id: $id, ')
          ..write('key: $key, ')
          ..write('labelKey: $labelKey, ')
          ..write('appliesTo: $appliesTo, ')
          ..write('type: $type, ')
          ..write('options: $options, ')
          ..write('isRestricted: $isRestricted, ')
          ..write('requiresConsent: $requiresConsent, ')
          ..write('enabled: $enabled, ')
          ..write('purpose: $purpose')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    key,
    labelKey,
    appliesTo,
    type,
    options,
    isRestricted,
    requiresConsent,
    enabled,
    purpose,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldDefinitionRow &&
          other.id == this.id &&
          other.key == this.key &&
          other.labelKey == this.labelKey &&
          other.appliesTo == this.appliesTo &&
          other.type == this.type &&
          other.options == this.options &&
          other.isRestricted == this.isRestricted &&
          other.requiresConsent == this.requiresConsent &&
          other.enabled == this.enabled &&
          other.purpose == this.purpose);
}

class FieldDefinitionsCompanion extends UpdateCompanion<FieldDefinitionRow> {
  final Value<String> id;
  final Value<String> key;
  final Value<String> labelKey;
  final Value<String> appliesTo;
  final Value<String> type;
  final Value<String?> options;
  final Value<bool> isRestricted;
  final Value<bool> requiresConsent;
  final Value<bool> enabled;
  final Value<String> purpose;
  final Value<int> rowid;
  const FieldDefinitionsCompanion({
    this.id = const Value.absent(),
    this.key = const Value.absent(),
    this.labelKey = const Value.absent(),
    this.appliesTo = const Value.absent(),
    this.type = const Value.absent(),
    this.options = const Value.absent(),
    this.isRestricted = const Value.absent(),
    this.requiresConsent = const Value.absent(),
    this.enabled = const Value.absent(),
    this.purpose = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldDefinitionsCompanion.insert({
    required String id,
    required String key,
    required String labelKey,
    required String appliesTo,
    required String type,
    this.options = const Value.absent(),
    required bool isRestricted,
    required bool requiresConsent,
    required bool enabled,
    required String purpose,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       key = Value(key),
       labelKey = Value(labelKey),
       appliesTo = Value(appliesTo),
       type = Value(type),
       isRestricted = Value(isRestricted),
       requiresConsent = Value(requiresConsent),
       enabled = Value(enabled),
       purpose = Value(purpose);
  static Insertable<FieldDefinitionRow> custom({
    Expression<String>? id,
    Expression<String>? key,
    Expression<String>? labelKey,
    Expression<String>? appliesTo,
    Expression<String>? type,
    Expression<String>? options,
    Expression<bool>? isRestricted,
    Expression<bool>? requiresConsent,
    Expression<bool>? enabled,
    Expression<String>? purpose,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (key != null) 'key': key,
      if (labelKey != null) 'label_key': labelKey,
      if (appliesTo != null) 'applies_to': appliesTo,
      if (type != null) 'type': type,
      if (options != null) 'options': options,
      if (isRestricted != null) 'is_restricted': isRestricted,
      if (requiresConsent != null) 'requires_consent': requiresConsent,
      if (enabled != null) 'enabled': enabled,
      if (purpose != null) 'purpose': purpose,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldDefinitionsCompanion copyWith({
    Value<String>? id,
    Value<String>? key,
    Value<String>? labelKey,
    Value<String>? appliesTo,
    Value<String>? type,
    Value<String?>? options,
    Value<bool>? isRestricted,
    Value<bool>? requiresConsent,
    Value<bool>? enabled,
    Value<String>? purpose,
    Value<int>? rowid,
  }) {
    return FieldDefinitionsCompanion(
      id: id ?? this.id,
      key: key ?? this.key,
      labelKey: labelKey ?? this.labelKey,
      appliesTo: appliesTo ?? this.appliesTo,
      type: type ?? this.type,
      options: options ?? this.options,
      isRestricted: isRestricted ?? this.isRestricted,
      requiresConsent: requiresConsent ?? this.requiresConsent,
      enabled: enabled ?? this.enabled,
      purpose: purpose ?? this.purpose,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (labelKey.present) {
      map['label_key'] = Variable<String>(labelKey.value);
    }
    if (appliesTo.present) {
      map['applies_to'] = Variable<String>(appliesTo.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (options.present) {
      map['options'] = Variable<String>(options.value);
    }
    if (isRestricted.present) {
      map['is_restricted'] = Variable<bool>(isRestricted.value);
    }
    if (requiresConsent.present) {
      map['requires_consent'] = Variable<bool>(requiresConsent.value);
    }
    if (enabled.present) {
      map['enabled'] = Variable<bool>(enabled.value);
    }
    if (purpose.present) {
      map['purpose'] = Variable<String>(purpose.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldDefinitionsCompanion(')
          ..write('id: $id, ')
          ..write('key: $key, ')
          ..write('labelKey: $labelKey, ')
          ..write('appliesTo: $appliesTo, ')
          ..write('type: $type, ')
          ..write('options: $options, ')
          ..write('isRestricted: $isRestricted, ')
          ..write('requiresConsent: $requiresConsent, ')
          ..write('enabled: $enabled, ')
          ..write('purpose: $purpose, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $HouseholdsTable extends Households
    with TableInfo<$HouseholdsTable, HouseholdRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $HouseholdsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _partIdMeta = const VerificationMeta('partId');
  @override
  late final GeneratedColumn<String> partId = GeneratedColumn<String>(
    'part_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _pollingStationIdMeta = const VerificationMeta(
    'pollingStationId',
  );
  @override
  late final GeneratedColumn<String> pollingStationId = GeneratedColumn<String>(
    'polling_station_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _displayAddressMeta = const VerificationMeta(
    'displayAddress',
  );
  @override
  late final GeneratedColumn<String> displayAddress = GeneratedColumn<String>(
    'display_address',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _houseKeyMeta = const VerificationMeta(
    'houseKey',
  );
  @override
  late final GeneratedColumn<String> houseKey = GeneratedColumn<String>(
    'house_key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _structuredAddressMeta = const VerificationMeta(
    'structuredAddress',
  );
  @override
  late final GeneratedColumn<String> structuredAddress =
      GeneratedColumn<String>(
        'structured_address',
        aliasedName,
        true,
        type: DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _latitudeMeta = const VerificationMeta(
    'latitude',
  );
  @override
  late final GeneratedColumn<double> latitude = GeneratedColumn<double>(
    'latitude',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _longitudeMeta = const VerificationMeta(
    'longitude',
  );
  @override
  late final GeneratedColumn<double> longitude = GeneratedColumn<double>(
    'longitude',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _accuracyMMeta = const VerificationMeta(
    'accuracyM',
  );
  @override
  late final GeneratedColumn<double> accuracyM = GeneratedColumn<double>(
    'accuracy_m',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _locationCapturedAtMeta =
      const VerificationMeta('locationCapturedAt');
  @override
  late final GeneratedColumn<DateTime> locationCapturedAt =
      GeneratedColumn<DateTime>(
        'location_captured_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _originMeta = const VerificationMeta('origin');
  @override
  late final GeneratedColumn<String> origin = GeneratedColumn<String>(
    'origin',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    partId,
    pollingStationId,
    displayAddress,
    houseKey,
    structuredAddress,
    latitude,
    longitude,
    accuracyM,
    locationCapturedAt,
    origin,
    status,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'households';
  @override
  VerificationContext validateIntegrity(
    Insertable<HouseholdRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('part_id')) {
      context.handle(
        _partIdMeta,
        partId.isAcceptableOrUnknown(data['part_id']!, _partIdMeta),
      );
    } else if (isInserting) {
      context.missing(_partIdMeta);
    }
    if (data.containsKey('polling_station_id')) {
      context.handle(
        _pollingStationIdMeta,
        pollingStationId.isAcceptableOrUnknown(
          data['polling_station_id']!,
          _pollingStationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_pollingStationIdMeta);
    }
    if (data.containsKey('display_address')) {
      context.handle(
        _displayAddressMeta,
        displayAddress.isAcceptableOrUnknown(
          data['display_address']!,
          _displayAddressMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_displayAddressMeta);
    }
    if (data.containsKey('house_key')) {
      context.handle(
        _houseKeyMeta,
        houseKey.isAcceptableOrUnknown(data['house_key']!, _houseKeyMeta),
      );
    } else if (isInserting) {
      context.missing(_houseKeyMeta);
    }
    if (data.containsKey('structured_address')) {
      context.handle(
        _structuredAddressMeta,
        structuredAddress.isAcceptableOrUnknown(
          data['structured_address']!,
          _structuredAddressMeta,
        ),
      );
    }
    if (data.containsKey('latitude')) {
      context.handle(
        _latitudeMeta,
        latitude.isAcceptableOrUnknown(data['latitude']!, _latitudeMeta),
      );
    }
    if (data.containsKey('longitude')) {
      context.handle(
        _longitudeMeta,
        longitude.isAcceptableOrUnknown(data['longitude']!, _longitudeMeta),
      );
    }
    if (data.containsKey('accuracy_m')) {
      context.handle(
        _accuracyMMeta,
        accuracyM.isAcceptableOrUnknown(data['accuracy_m']!, _accuracyMMeta),
      );
    }
    if (data.containsKey('location_captured_at')) {
      context.handle(
        _locationCapturedAtMeta,
        locationCapturedAt.isAcceptableOrUnknown(
          data['location_captured_at']!,
          _locationCapturedAtMeta,
        ),
      );
    }
    if (data.containsKey('origin')) {
      context.handle(
        _originMeta,
        origin.isAcceptableOrUnknown(data['origin']!, _originMeta),
      );
    } else if (isInserting) {
      context.missing(_originMeta);
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  HouseholdRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return HouseholdRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      partId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}part_id'],
      )!,
      pollingStationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}polling_station_id'],
      )!,
      displayAddress: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}display_address'],
      )!,
      houseKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}house_key'],
      )!,
      structuredAddress: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}structured_address'],
      ),
      latitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}latitude'],
      ),
      longitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}longitude'],
      ),
      accuracyM: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}accuracy_m'],
      ),
      locationCapturedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}location_captured_at'],
      ),
      origin: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}origin'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
    );
  }

  @override
  $HouseholdsTable createAlias(String alias) {
    return $HouseholdsTable(attachedDatabase, alias);
  }
}

class HouseholdRow extends DataClass implements Insertable<HouseholdRow> {
  final String id;
  final String partId;
  final String pollingStationId;
  final String displayAddress;
  final String houseKey;

  /// JSON.
  final String? structuredAddress;
  final double? latitude;
  final double? longitude;
  final double? accuracyM;
  final DateTime? locationCapturedAt;
  final String origin;

  /// `removed`: no longer in the roll.
  final String status;
  const HouseholdRow({
    required this.id,
    required this.partId,
    required this.pollingStationId,
    required this.displayAddress,
    required this.houseKey,
    this.structuredAddress,
    this.latitude,
    this.longitude,
    this.accuracyM,
    this.locationCapturedAt,
    required this.origin,
    required this.status,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['part_id'] = Variable<String>(partId);
    map['polling_station_id'] = Variable<String>(pollingStationId);
    map['display_address'] = Variable<String>(displayAddress);
    map['house_key'] = Variable<String>(houseKey);
    if (!nullToAbsent || structuredAddress != null) {
      map['structured_address'] = Variable<String>(structuredAddress);
    }
    if (!nullToAbsent || latitude != null) {
      map['latitude'] = Variable<double>(latitude);
    }
    if (!nullToAbsent || longitude != null) {
      map['longitude'] = Variable<double>(longitude);
    }
    if (!nullToAbsent || accuracyM != null) {
      map['accuracy_m'] = Variable<double>(accuracyM);
    }
    if (!nullToAbsent || locationCapturedAt != null) {
      map['location_captured_at'] = Variable<DateTime>(locationCapturedAt);
    }
    map['origin'] = Variable<String>(origin);
    map['status'] = Variable<String>(status);
    return map;
  }

  HouseholdsCompanion toCompanion(bool nullToAbsent) {
    return HouseholdsCompanion(
      id: Value(id),
      partId: Value(partId),
      pollingStationId: Value(pollingStationId),
      displayAddress: Value(displayAddress),
      houseKey: Value(houseKey),
      structuredAddress: structuredAddress == null && nullToAbsent
          ? const Value.absent()
          : Value(structuredAddress),
      latitude: latitude == null && nullToAbsent
          ? const Value.absent()
          : Value(latitude),
      longitude: longitude == null && nullToAbsent
          ? const Value.absent()
          : Value(longitude),
      accuracyM: accuracyM == null && nullToAbsent
          ? const Value.absent()
          : Value(accuracyM),
      locationCapturedAt: locationCapturedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(locationCapturedAt),
      origin: Value(origin),
      status: Value(status),
    );
  }

  factory HouseholdRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return HouseholdRow(
      id: serializer.fromJson<String>(json['id']),
      partId: serializer.fromJson<String>(json['partId']),
      pollingStationId: serializer.fromJson<String>(json['pollingStationId']),
      displayAddress: serializer.fromJson<String>(json['displayAddress']),
      houseKey: serializer.fromJson<String>(json['houseKey']),
      structuredAddress: serializer.fromJson<String?>(
        json['structuredAddress'],
      ),
      latitude: serializer.fromJson<double?>(json['latitude']),
      longitude: serializer.fromJson<double?>(json['longitude']),
      accuracyM: serializer.fromJson<double?>(json['accuracyM']),
      locationCapturedAt: serializer.fromJson<DateTime?>(
        json['locationCapturedAt'],
      ),
      origin: serializer.fromJson<String>(json['origin']),
      status: serializer.fromJson<String>(json['status']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'partId': serializer.toJson<String>(partId),
      'pollingStationId': serializer.toJson<String>(pollingStationId),
      'displayAddress': serializer.toJson<String>(displayAddress),
      'houseKey': serializer.toJson<String>(houseKey),
      'structuredAddress': serializer.toJson<String?>(structuredAddress),
      'latitude': serializer.toJson<double?>(latitude),
      'longitude': serializer.toJson<double?>(longitude),
      'accuracyM': serializer.toJson<double?>(accuracyM),
      'locationCapturedAt': serializer.toJson<DateTime?>(locationCapturedAt),
      'origin': serializer.toJson<String>(origin),
      'status': serializer.toJson<String>(status),
    };
  }

  HouseholdRow copyWith({
    String? id,
    String? partId,
    String? pollingStationId,
    String? displayAddress,
    String? houseKey,
    Value<String?> structuredAddress = const Value.absent(),
    Value<double?> latitude = const Value.absent(),
    Value<double?> longitude = const Value.absent(),
    Value<double?> accuracyM = const Value.absent(),
    Value<DateTime?> locationCapturedAt = const Value.absent(),
    String? origin,
    String? status,
  }) => HouseholdRow(
    id: id ?? this.id,
    partId: partId ?? this.partId,
    pollingStationId: pollingStationId ?? this.pollingStationId,
    displayAddress: displayAddress ?? this.displayAddress,
    houseKey: houseKey ?? this.houseKey,
    structuredAddress: structuredAddress.present
        ? structuredAddress.value
        : this.structuredAddress,
    latitude: latitude.present ? latitude.value : this.latitude,
    longitude: longitude.present ? longitude.value : this.longitude,
    accuracyM: accuracyM.present ? accuracyM.value : this.accuracyM,
    locationCapturedAt: locationCapturedAt.present
        ? locationCapturedAt.value
        : this.locationCapturedAt,
    origin: origin ?? this.origin,
    status: status ?? this.status,
  );
  HouseholdRow copyWithCompanion(HouseholdsCompanion data) {
    return HouseholdRow(
      id: data.id.present ? data.id.value : this.id,
      partId: data.partId.present ? data.partId.value : this.partId,
      pollingStationId: data.pollingStationId.present
          ? data.pollingStationId.value
          : this.pollingStationId,
      displayAddress: data.displayAddress.present
          ? data.displayAddress.value
          : this.displayAddress,
      houseKey: data.houseKey.present ? data.houseKey.value : this.houseKey,
      structuredAddress: data.structuredAddress.present
          ? data.structuredAddress.value
          : this.structuredAddress,
      latitude: data.latitude.present ? data.latitude.value : this.latitude,
      longitude: data.longitude.present ? data.longitude.value : this.longitude,
      accuracyM: data.accuracyM.present ? data.accuracyM.value : this.accuracyM,
      locationCapturedAt: data.locationCapturedAt.present
          ? data.locationCapturedAt.value
          : this.locationCapturedAt,
      origin: data.origin.present ? data.origin.value : this.origin,
      status: data.status.present ? data.status.value : this.status,
    );
  }

  @override
  String toString() {
    return (StringBuffer('HouseholdRow(')
          ..write('id: $id, ')
          ..write('partId: $partId, ')
          ..write('pollingStationId: $pollingStationId, ')
          ..write('displayAddress: $displayAddress, ')
          ..write('houseKey: $houseKey, ')
          ..write('structuredAddress: $structuredAddress, ')
          ..write('latitude: $latitude, ')
          ..write('longitude: $longitude, ')
          ..write('accuracyM: $accuracyM, ')
          ..write('locationCapturedAt: $locationCapturedAt, ')
          ..write('origin: $origin, ')
          ..write('status: $status')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    partId,
    pollingStationId,
    displayAddress,
    houseKey,
    structuredAddress,
    latitude,
    longitude,
    accuracyM,
    locationCapturedAt,
    origin,
    status,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is HouseholdRow &&
          other.id == this.id &&
          other.partId == this.partId &&
          other.pollingStationId == this.pollingStationId &&
          other.displayAddress == this.displayAddress &&
          other.houseKey == this.houseKey &&
          other.structuredAddress == this.structuredAddress &&
          other.latitude == this.latitude &&
          other.longitude == this.longitude &&
          other.accuracyM == this.accuracyM &&
          other.locationCapturedAt == this.locationCapturedAt &&
          other.origin == this.origin &&
          other.status == this.status);
}

class HouseholdsCompanion extends UpdateCompanion<HouseholdRow> {
  final Value<String> id;
  final Value<String> partId;
  final Value<String> pollingStationId;
  final Value<String> displayAddress;
  final Value<String> houseKey;
  final Value<String?> structuredAddress;
  final Value<double?> latitude;
  final Value<double?> longitude;
  final Value<double?> accuracyM;
  final Value<DateTime?> locationCapturedAt;
  final Value<String> origin;
  final Value<String> status;
  final Value<int> rowid;
  const HouseholdsCompanion({
    this.id = const Value.absent(),
    this.partId = const Value.absent(),
    this.pollingStationId = const Value.absent(),
    this.displayAddress = const Value.absent(),
    this.houseKey = const Value.absent(),
    this.structuredAddress = const Value.absent(),
    this.latitude = const Value.absent(),
    this.longitude = const Value.absent(),
    this.accuracyM = const Value.absent(),
    this.locationCapturedAt = const Value.absent(),
    this.origin = const Value.absent(),
    this.status = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  HouseholdsCompanion.insert({
    required String id,
    required String partId,
    required String pollingStationId,
    required String displayAddress,
    required String houseKey,
    this.structuredAddress = const Value.absent(),
    this.latitude = const Value.absent(),
    this.longitude = const Value.absent(),
    this.accuracyM = const Value.absent(),
    this.locationCapturedAt = const Value.absent(),
    required String origin,
    required String status,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       partId = Value(partId),
       pollingStationId = Value(pollingStationId),
       displayAddress = Value(displayAddress),
       houseKey = Value(houseKey),
       origin = Value(origin),
       status = Value(status);
  static Insertable<HouseholdRow> custom({
    Expression<String>? id,
    Expression<String>? partId,
    Expression<String>? pollingStationId,
    Expression<String>? displayAddress,
    Expression<String>? houseKey,
    Expression<String>? structuredAddress,
    Expression<double>? latitude,
    Expression<double>? longitude,
    Expression<double>? accuracyM,
    Expression<DateTime>? locationCapturedAt,
    Expression<String>? origin,
    Expression<String>? status,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (partId != null) 'part_id': partId,
      if (pollingStationId != null) 'polling_station_id': pollingStationId,
      if (displayAddress != null) 'display_address': displayAddress,
      if (houseKey != null) 'house_key': houseKey,
      if (structuredAddress != null) 'structured_address': structuredAddress,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      if (accuracyM != null) 'accuracy_m': accuracyM,
      if (locationCapturedAt != null)
        'location_captured_at': locationCapturedAt,
      if (origin != null) 'origin': origin,
      if (status != null) 'status': status,
      if (rowid != null) 'rowid': rowid,
    });
  }

  HouseholdsCompanion copyWith({
    Value<String>? id,
    Value<String>? partId,
    Value<String>? pollingStationId,
    Value<String>? displayAddress,
    Value<String>? houseKey,
    Value<String?>? structuredAddress,
    Value<double?>? latitude,
    Value<double?>? longitude,
    Value<double?>? accuracyM,
    Value<DateTime?>? locationCapturedAt,
    Value<String>? origin,
    Value<String>? status,
    Value<int>? rowid,
  }) {
    return HouseholdsCompanion(
      id: id ?? this.id,
      partId: partId ?? this.partId,
      pollingStationId: pollingStationId ?? this.pollingStationId,
      displayAddress: displayAddress ?? this.displayAddress,
      houseKey: houseKey ?? this.houseKey,
      structuredAddress: structuredAddress ?? this.structuredAddress,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      accuracyM: accuracyM ?? this.accuracyM,
      locationCapturedAt: locationCapturedAt ?? this.locationCapturedAt,
      origin: origin ?? this.origin,
      status: status ?? this.status,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (partId.present) {
      map['part_id'] = Variable<String>(partId.value);
    }
    if (pollingStationId.present) {
      map['polling_station_id'] = Variable<String>(pollingStationId.value);
    }
    if (displayAddress.present) {
      map['display_address'] = Variable<String>(displayAddress.value);
    }
    if (houseKey.present) {
      map['house_key'] = Variable<String>(houseKey.value);
    }
    if (structuredAddress.present) {
      map['structured_address'] = Variable<String>(structuredAddress.value);
    }
    if (latitude.present) {
      map['latitude'] = Variable<double>(latitude.value);
    }
    if (longitude.present) {
      map['longitude'] = Variable<double>(longitude.value);
    }
    if (accuracyM.present) {
      map['accuracy_m'] = Variable<double>(accuracyM.value);
    }
    if (locationCapturedAt.present) {
      map['location_captured_at'] = Variable<DateTime>(
        locationCapturedAt.value,
      );
    }
    if (origin.present) {
      map['origin'] = Variable<String>(origin.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('HouseholdsCompanion(')
          ..write('id: $id, ')
          ..write('partId: $partId, ')
          ..write('pollingStationId: $pollingStationId, ')
          ..write('displayAddress: $displayAddress, ')
          ..write('houseKey: $houseKey, ')
          ..write('structuredAddress: $structuredAddress, ')
          ..write('latitude: $latitude, ')
          ..write('longitude: $longitude, ')
          ..write('accuracyM: $accuracyM, ')
          ..write('locationCapturedAt: $locationCapturedAt, ')
          ..write('origin: $origin, ')
          ..write('status: $status, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $VotersTable extends Voters with TableInfo<$VotersTable, VoterRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $VotersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _householdIdMeta = const VerificationMeta(
    'householdId',
  );
  @override
  late final GeneratedColumn<String> householdId = GeneratedColumn<String>(
    'household_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _partIdMeta = const VerificationMeta('partId');
  @override
  late final GeneratedColumn<String> partId = GeneratedColumn<String>(
    'part_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _pollingStationIdMeta = const VerificationMeta(
    'pollingStationId',
  );
  @override
  late final GeneratedColumn<String> pollingStationId = GeneratedColumn<String>(
    'polling_station_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _originMeta = const VerificationMeta('origin');
  @override
  late final GeneratedColumn<String> origin = GeneratedColumn<String>(
    'origin',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _recordStatusMeta = const VerificationMeta(
    'recordStatus',
  );
  @override
  late final GeneratedColumn<String> recordStatus = GeneratedColumn<String>(
    'record_status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sectionNoMeta = const VerificationMeta(
    'sectionNo',
  );
  @override
  late final GeneratedColumn<int> sectionNo = GeneratedColumn<int>(
    'section_no',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serialNoMeta = const VerificationMeta(
    'serialNo',
  );
  @override
  late final GeneratedColumn<int> serialNo = GeneratedColumn<int>(
    'serial_no',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _epicNumberMeta = const VerificationMeta(
    'epicNumber',
  );
  @override
  late final GeneratedColumn<String> epicNumber = GeneratedColumn<String>(
    'epic_number',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _officialMeta = const VerificationMeta(
    'official',
  );
  @override
  late final GeneratedColumn<String> official = GeneratedColumn<String>(
    'official',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  late final GeneratedColumnWithTypeConverter<List<String>, String>
  previousVoterIds = GeneratedColumn<String>(
    'previous_voter_ids',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  ).withConverter<List<String>>($VotersTable.$converterpreviousVoterIds);
  @override
  List<GeneratedColumn> get $columns => [
    id,
    householdId,
    partId,
    pollingStationId,
    origin,
    recordStatus,
    sectionNo,
    serialNo,
    epicNumber,
    official,
    previousVoterIds,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'voters';
  @override
  VerificationContext validateIntegrity(
    Insertable<VoterRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('household_id')) {
      context.handle(
        _householdIdMeta,
        householdId.isAcceptableOrUnknown(
          data['household_id']!,
          _householdIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_householdIdMeta);
    }
    if (data.containsKey('part_id')) {
      context.handle(
        _partIdMeta,
        partId.isAcceptableOrUnknown(data['part_id']!, _partIdMeta),
      );
    } else if (isInserting) {
      context.missing(_partIdMeta);
    }
    if (data.containsKey('polling_station_id')) {
      context.handle(
        _pollingStationIdMeta,
        pollingStationId.isAcceptableOrUnknown(
          data['polling_station_id']!,
          _pollingStationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_pollingStationIdMeta);
    }
    if (data.containsKey('origin')) {
      context.handle(
        _originMeta,
        origin.isAcceptableOrUnknown(data['origin']!, _originMeta),
      );
    } else if (isInserting) {
      context.missing(_originMeta);
    }
    if (data.containsKey('record_status')) {
      context.handle(
        _recordStatusMeta,
        recordStatus.isAcceptableOrUnknown(
          data['record_status']!,
          _recordStatusMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_recordStatusMeta);
    }
    if (data.containsKey('section_no')) {
      context.handle(
        _sectionNoMeta,
        sectionNo.isAcceptableOrUnknown(data['section_no']!, _sectionNoMeta),
      );
    }
    if (data.containsKey('serial_no')) {
      context.handle(
        _serialNoMeta,
        serialNo.isAcceptableOrUnknown(data['serial_no']!, _serialNoMeta),
      );
    }
    if (data.containsKey('epic_number')) {
      context.handle(
        _epicNumberMeta,
        epicNumber.isAcceptableOrUnknown(data['epic_number']!, _epicNumberMeta),
      );
    }
    if (data.containsKey('official')) {
      context.handle(
        _officialMeta,
        official.isAcceptableOrUnknown(data['official']!, _officialMeta),
      );
    } else if (isInserting) {
      context.missing(_officialMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  VoterRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return VoterRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      householdId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}household_id'],
      )!,
      partId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}part_id'],
      )!,
      pollingStationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}polling_station_id'],
      )!,
      origin: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}origin'],
      )!,
      recordStatus: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}record_status'],
      )!,
      sectionNo: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}section_no'],
      ),
      serialNo: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}serial_no'],
      ),
      epicNumber: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}epic_number'],
      ),
      official: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}official'],
      )!,
      previousVoterIds: $VotersTable.$converterpreviousVoterIds.fromSql(
        attachedDatabase.typeMapping.read(
          DriftSqlType.string,
          data['${effectivePrefix}previous_voter_ids'],
        )!,
      ),
    );
  }

  @override
  $VotersTable createAlias(String alias) {
    return $VotersTable(attachedDatabase, alias);
  }

  static TypeConverter<List<String>, String> $converterpreviousVoterIds =
      const StringListConverter();
}

class VoterRow extends DataClass implements Insertable<VoterRow> {
  final String id;
  final String householdId;
  final String partId;
  final String pollingStationId;
  final String origin;

  /// Anything but `active`: not shown in the household.
  final String recordStatus;
  final int? sectionNo;
  final int? serialNo;
  final String? epicNumber;

  /// JSON: the roll's values (name, age, gender, relation, house number).
  final String official;

  /// Earlier records of this voter that newer rolls replaced.
  final List<String> previousVoterIds;
  const VoterRow({
    required this.id,
    required this.householdId,
    required this.partId,
    required this.pollingStationId,
    required this.origin,
    required this.recordStatus,
    this.sectionNo,
    this.serialNo,
    this.epicNumber,
    required this.official,
    required this.previousVoterIds,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['household_id'] = Variable<String>(householdId);
    map['part_id'] = Variable<String>(partId);
    map['polling_station_id'] = Variable<String>(pollingStationId);
    map['origin'] = Variable<String>(origin);
    map['record_status'] = Variable<String>(recordStatus);
    if (!nullToAbsent || sectionNo != null) {
      map['section_no'] = Variable<int>(sectionNo);
    }
    if (!nullToAbsent || serialNo != null) {
      map['serial_no'] = Variable<int>(serialNo);
    }
    if (!nullToAbsent || epicNumber != null) {
      map['epic_number'] = Variable<String>(epicNumber);
    }
    map['official'] = Variable<String>(official);
    {
      map['previous_voter_ids'] = Variable<String>(
        $VotersTable.$converterpreviousVoterIds.toSql(previousVoterIds),
      );
    }
    return map;
  }

  VotersCompanion toCompanion(bool nullToAbsent) {
    return VotersCompanion(
      id: Value(id),
      householdId: Value(householdId),
      partId: Value(partId),
      pollingStationId: Value(pollingStationId),
      origin: Value(origin),
      recordStatus: Value(recordStatus),
      sectionNo: sectionNo == null && nullToAbsent
          ? const Value.absent()
          : Value(sectionNo),
      serialNo: serialNo == null && nullToAbsent
          ? const Value.absent()
          : Value(serialNo),
      epicNumber: epicNumber == null && nullToAbsent
          ? const Value.absent()
          : Value(epicNumber),
      official: Value(official),
      previousVoterIds: Value(previousVoterIds),
    );
  }

  factory VoterRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return VoterRow(
      id: serializer.fromJson<String>(json['id']),
      householdId: serializer.fromJson<String>(json['householdId']),
      partId: serializer.fromJson<String>(json['partId']),
      pollingStationId: serializer.fromJson<String>(json['pollingStationId']),
      origin: serializer.fromJson<String>(json['origin']),
      recordStatus: serializer.fromJson<String>(json['recordStatus']),
      sectionNo: serializer.fromJson<int?>(json['sectionNo']),
      serialNo: serializer.fromJson<int?>(json['serialNo']),
      epicNumber: serializer.fromJson<String?>(json['epicNumber']),
      official: serializer.fromJson<String>(json['official']),
      previousVoterIds: serializer.fromJson<List<String>>(
        json['previousVoterIds'],
      ),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'householdId': serializer.toJson<String>(householdId),
      'partId': serializer.toJson<String>(partId),
      'pollingStationId': serializer.toJson<String>(pollingStationId),
      'origin': serializer.toJson<String>(origin),
      'recordStatus': serializer.toJson<String>(recordStatus),
      'sectionNo': serializer.toJson<int?>(sectionNo),
      'serialNo': serializer.toJson<int?>(serialNo),
      'epicNumber': serializer.toJson<String?>(epicNumber),
      'official': serializer.toJson<String>(official),
      'previousVoterIds': serializer.toJson<List<String>>(previousVoterIds),
    };
  }

  VoterRow copyWith({
    String? id,
    String? householdId,
    String? partId,
    String? pollingStationId,
    String? origin,
    String? recordStatus,
    Value<int?> sectionNo = const Value.absent(),
    Value<int?> serialNo = const Value.absent(),
    Value<String?> epicNumber = const Value.absent(),
    String? official,
    List<String>? previousVoterIds,
  }) => VoterRow(
    id: id ?? this.id,
    householdId: householdId ?? this.householdId,
    partId: partId ?? this.partId,
    pollingStationId: pollingStationId ?? this.pollingStationId,
    origin: origin ?? this.origin,
    recordStatus: recordStatus ?? this.recordStatus,
    sectionNo: sectionNo.present ? sectionNo.value : this.sectionNo,
    serialNo: serialNo.present ? serialNo.value : this.serialNo,
    epicNumber: epicNumber.present ? epicNumber.value : this.epicNumber,
    official: official ?? this.official,
    previousVoterIds: previousVoterIds ?? this.previousVoterIds,
  );
  VoterRow copyWithCompanion(VotersCompanion data) {
    return VoterRow(
      id: data.id.present ? data.id.value : this.id,
      householdId: data.householdId.present
          ? data.householdId.value
          : this.householdId,
      partId: data.partId.present ? data.partId.value : this.partId,
      pollingStationId: data.pollingStationId.present
          ? data.pollingStationId.value
          : this.pollingStationId,
      origin: data.origin.present ? data.origin.value : this.origin,
      recordStatus: data.recordStatus.present
          ? data.recordStatus.value
          : this.recordStatus,
      sectionNo: data.sectionNo.present ? data.sectionNo.value : this.sectionNo,
      serialNo: data.serialNo.present ? data.serialNo.value : this.serialNo,
      epicNumber: data.epicNumber.present
          ? data.epicNumber.value
          : this.epicNumber,
      official: data.official.present ? data.official.value : this.official,
      previousVoterIds: data.previousVoterIds.present
          ? data.previousVoterIds.value
          : this.previousVoterIds,
    );
  }

  @override
  String toString() {
    return (StringBuffer('VoterRow(')
          ..write('id: $id, ')
          ..write('householdId: $householdId, ')
          ..write('partId: $partId, ')
          ..write('pollingStationId: $pollingStationId, ')
          ..write('origin: $origin, ')
          ..write('recordStatus: $recordStatus, ')
          ..write('sectionNo: $sectionNo, ')
          ..write('serialNo: $serialNo, ')
          ..write('epicNumber: $epicNumber, ')
          ..write('official: $official, ')
          ..write('previousVoterIds: $previousVoterIds')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    householdId,
    partId,
    pollingStationId,
    origin,
    recordStatus,
    sectionNo,
    serialNo,
    epicNumber,
    official,
    previousVoterIds,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is VoterRow &&
          other.id == this.id &&
          other.householdId == this.householdId &&
          other.partId == this.partId &&
          other.pollingStationId == this.pollingStationId &&
          other.origin == this.origin &&
          other.recordStatus == this.recordStatus &&
          other.sectionNo == this.sectionNo &&
          other.serialNo == this.serialNo &&
          other.epicNumber == this.epicNumber &&
          other.official == this.official &&
          other.previousVoterIds == this.previousVoterIds);
}

class VotersCompanion extends UpdateCompanion<VoterRow> {
  final Value<String> id;
  final Value<String> householdId;
  final Value<String> partId;
  final Value<String> pollingStationId;
  final Value<String> origin;
  final Value<String> recordStatus;
  final Value<int?> sectionNo;
  final Value<int?> serialNo;
  final Value<String?> epicNumber;
  final Value<String> official;
  final Value<List<String>> previousVoterIds;
  final Value<int> rowid;
  const VotersCompanion({
    this.id = const Value.absent(),
    this.householdId = const Value.absent(),
    this.partId = const Value.absent(),
    this.pollingStationId = const Value.absent(),
    this.origin = const Value.absent(),
    this.recordStatus = const Value.absent(),
    this.sectionNo = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.epicNumber = const Value.absent(),
    this.official = const Value.absent(),
    this.previousVoterIds = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  VotersCompanion.insert({
    required String id,
    required String householdId,
    required String partId,
    required String pollingStationId,
    required String origin,
    required String recordStatus,
    this.sectionNo = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.epicNumber = const Value.absent(),
    required String official,
    required List<String> previousVoterIds,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       householdId = Value(householdId),
       partId = Value(partId),
       pollingStationId = Value(pollingStationId),
       origin = Value(origin),
       recordStatus = Value(recordStatus),
       official = Value(official),
       previousVoterIds = Value(previousVoterIds);
  static Insertable<VoterRow> custom({
    Expression<String>? id,
    Expression<String>? householdId,
    Expression<String>? partId,
    Expression<String>? pollingStationId,
    Expression<String>? origin,
    Expression<String>? recordStatus,
    Expression<int>? sectionNo,
    Expression<int>? serialNo,
    Expression<String>? epicNumber,
    Expression<String>? official,
    Expression<String>? previousVoterIds,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (householdId != null) 'household_id': householdId,
      if (partId != null) 'part_id': partId,
      if (pollingStationId != null) 'polling_station_id': pollingStationId,
      if (origin != null) 'origin': origin,
      if (recordStatus != null) 'record_status': recordStatus,
      if (sectionNo != null) 'section_no': sectionNo,
      if (serialNo != null) 'serial_no': serialNo,
      if (epicNumber != null) 'epic_number': epicNumber,
      if (official != null) 'official': official,
      if (previousVoterIds != null) 'previous_voter_ids': previousVoterIds,
      if (rowid != null) 'rowid': rowid,
    });
  }

  VotersCompanion copyWith({
    Value<String>? id,
    Value<String>? householdId,
    Value<String>? partId,
    Value<String>? pollingStationId,
    Value<String>? origin,
    Value<String>? recordStatus,
    Value<int?>? sectionNo,
    Value<int?>? serialNo,
    Value<String?>? epicNumber,
    Value<String>? official,
    Value<List<String>>? previousVoterIds,
    Value<int>? rowid,
  }) {
    return VotersCompanion(
      id: id ?? this.id,
      householdId: householdId ?? this.householdId,
      partId: partId ?? this.partId,
      pollingStationId: pollingStationId ?? this.pollingStationId,
      origin: origin ?? this.origin,
      recordStatus: recordStatus ?? this.recordStatus,
      sectionNo: sectionNo ?? this.sectionNo,
      serialNo: serialNo ?? this.serialNo,
      epicNumber: epicNumber ?? this.epicNumber,
      official: official ?? this.official,
      previousVoterIds: previousVoterIds ?? this.previousVoterIds,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (householdId.present) {
      map['household_id'] = Variable<String>(householdId.value);
    }
    if (partId.present) {
      map['part_id'] = Variable<String>(partId.value);
    }
    if (pollingStationId.present) {
      map['polling_station_id'] = Variable<String>(pollingStationId.value);
    }
    if (origin.present) {
      map['origin'] = Variable<String>(origin.value);
    }
    if (recordStatus.present) {
      map['record_status'] = Variable<String>(recordStatus.value);
    }
    if (sectionNo.present) {
      map['section_no'] = Variable<int>(sectionNo.value);
    }
    if (serialNo.present) {
      map['serial_no'] = Variable<int>(serialNo.value);
    }
    if (epicNumber.present) {
      map['epic_number'] = Variable<String>(epicNumber.value);
    }
    if (official.present) {
      map['official'] = Variable<String>(official.value);
    }
    if (previousVoterIds.present) {
      map['previous_voter_ids'] = Variable<String>(
        $VotersTable.$converterpreviousVoterIds.toSql(previousVoterIds.value),
      );
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('VotersCompanion(')
          ..write('id: $id, ')
          ..write('householdId: $householdId, ')
          ..write('partId: $partId, ')
          ..write('pollingStationId: $pollingStationId, ')
          ..write('origin: $origin, ')
          ..write('recordStatus: $recordStatus, ')
          ..write('sectionNo: $sectionNo, ')
          ..write('serialNo: $serialNo, ')
          ..write('epicNumber: $epicNumber, ')
          ..write('official: $official, ')
          ..write('previousVoterIds: $previousVoterIds, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldValuesTable extends FieldValues
    with TableInfo<$FieldValuesTable, FieldValueRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldValuesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _entityTypeMeta = const VerificationMeta(
    'entityType',
  );
  @override
  late final GeneratedColumn<String> entityType = GeneratedColumn<String>(
    'entity_type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _entityIdMeta = const VerificationMeta(
    'entityId',
  );
  @override
  late final GeneratedColumn<String> entityId = GeneratedColumn<String>(
    'entity_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _fieldKeyMeta = const VerificationMeta(
    'fieldKey',
  );
  @override
  late final GeneratedColumn<String> fieldKey = GeneratedColumn<String>(
    'field_key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sourceTypeMeta = const VerificationMeta(
    'sourceType',
  );
  @override
  late final GeneratedColumn<String> sourceType = GeneratedColumn<String>(
    'source_type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _collectedByIdMeta = const VerificationMeta(
    'collectedById',
  );
  @override
  late final GeneratedColumn<String> collectedById = GeneratedColumn<String>(
    'collected_by_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _collectedByNameMeta = const VerificationMeta(
    'collectedByName',
  );
  @override
  late final GeneratedColumn<String> collectedByName = GeneratedColumn<String>(
    'collected_by_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _collectedAtMeta = const VerificationMeta(
    'collectedAt',
  );
  @override
  late final GeneratedColumn<DateTime> collectedAt = GeneratedColumn<DateTime>(
    'collected_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _supersedesIdMeta = const VerificationMeta(
    'supersedesId',
  );
  @override
  late final GeneratedColumn<String> supersedesId = GeneratedColumn<String>(
    'supersedes_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _carriedFromIdMeta = const VerificationMeta(
    'carriedFromId',
  );
  @override
  late final GeneratedColumn<String> carriedFromId = GeneratedColumn<String>(
    'carried_from_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isCurrentMeta = const VerificationMeta(
    'isCurrent',
  );
  @override
  late final GeneratedColumn<bool> isCurrent = GeneratedColumn<bool>(
    'is_current',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_current" IN (0, 1))',
    ),
  );
  static const VerificationMeta _conflictWithIdMeta = const VerificationMeta(
    'conflictWithId',
  );
  @override
  late final GeneratedColumn<String> conflictWithId = GeneratedColumn<String>(
    'conflict_with_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    entityType,
    entityId,
    fieldKey,
    value,
    sourceType,
    collectedById,
    collectedByName,
    collectedAt,
    supersedesId,
    carriedFromId,
    isCurrent,
    conflictWithId,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_values';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldValueRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('entity_type')) {
      context.handle(
        _entityTypeMeta,
        entityType.isAcceptableOrUnknown(data['entity_type']!, _entityTypeMeta),
      );
    } else if (isInserting) {
      context.missing(_entityTypeMeta);
    }
    if (data.containsKey('entity_id')) {
      context.handle(
        _entityIdMeta,
        entityId.isAcceptableOrUnknown(data['entity_id']!, _entityIdMeta),
      );
    } else if (isInserting) {
      context.missing(_entityIdMeta);
    }
    if (data.containsKey('field_key')) {
      context.handle(
        _fieldKeyMeta,
        fieldKey.isAcceptableOrUnknown(data['field_key']!, _fieldKeyMeta),
      );
    } else if (isInserting) {
      context.missing(_fieldKeyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    if (data.containsKey('source_type')) {
      context.handle(
        _sourceTypeMeta,
        sourceType.isAcceptableOrUnknown(data['source_type']!, _sourceTypeMeta),
      );
    } else if (isInserting) {
      context.missing(_sourceTypeMeta);
    }
    if (data.containsKey('collected_by_id')) {
      context.handle(
        _collectedByIdMeta,
        collectedById.isAcceptableOrUnknown(
          data['collected_by_id']!,
          _collectedByIdMeta,
        ),
      );
    }
    if (data.containsKey('collected_by_name')) {
      context.handle(
        _collectedByNameMeta,
        collectedByName.isAcceptableOrUnknown(
          data['collected_by_name']!,
          _collectedByNameMeta,
        ),
      );
    }
    if (data.containsKey('collected_at')) {
      context.handle(
        _collectedAtMeta,
        collectedAt.isAcceptableOrUnknown(
          data['collected_at']!,
          _collectedAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_collectedAtMeta);
    }
    if (data.containsKey('supersedes_id')) {
      context.handle(
        _supersedesIdMeta,
        supersedesId.isAcceptableOrUnknown(
          data['supersedes_id']!,
          _supersedesIdMeta,
        ),
      );
    }
    if (data.containsKey('carried_from_id')) {
      context.handle(
        _carriedFromIdMeta,
        carriedFromId.isAcceptableOrUnknown(
          data['carried_from_id']!,
          _carriedFromIdMeta,
        ),
      );
    }
    if (data.containsKey('is_current')) {
      context.handle(
        _isCurrentMeta,
        isCurrent.isAcceptableOrUnknown(data['is_current']!, _isCurrentMeta),
      );
    } else if (isInserting) {
      context.missing(_isCurrentMeta);
    }
    if (data.containsKey('conflict_with_id')) {
      context.handle(
        _conflictWithIdMeta,
        conflictWithId.isAcceptableOrUnknown(
          data['conflict_with_id']!,
          _conflictWithIdMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  FieldValueRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldValueRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      entityType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}entity_type'],
      )!,
      entityId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}entity_id'],
      )!,
      fieldKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}field_key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
      sourceType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}source_type'],
      )!,
      collectedById: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}collected_by_id'],
      ),
      collectedByName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}collected_by_name'],
      ),
      collectedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}collected_at'],
      )!,
      supersedesId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}supersedes_id'],
      ),
      carriedFromId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}carried_from_id'],
      ),
      isCurrent: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_current'],
      )!,
      conflictWithId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conflict_with_id'],
      ),
    );
  }

  @override
  $FieldValuesTable createAlias(String alias) {
    return $FieldValuesTable(attachedDatabase, alias);
  }
}

class FieldValueRow extends DataClass implements Insertable<FieldValueRow> {
  final String id;

  /// `household` or `voter`.
  final String entityType;
  final String entityId;
  final String fieldKey;

  /// JSON.
  final String value;
  final String sourceType;
  final String? collectedById;
  final String? collectedByName;
  final DateTime collectedAt;
  final String? supersedesId;
  final String? carriedFromId;
  final bool isCurrent;
  final String? conflictWithId;
  const FieldValueRow({
    required this.id,
    required this.entityType,
    required this.entityId,
    required this.fieldKey,
    required this.value,
    required this.sourceType,
    this.collectedById,
    this.collectedByName,
    required this.collectedAt,
    this.supersedesId,
    this.carriedFromId,
    required this.isCurrent,
    this.conflictWithId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['entity_type'] = Variable<String>(entityType);
    map['entity_id'] = Variable<String>(entityId);
    map['field_key'] = Variable<String>(fieldKey);
    map['value'] = Variable<String>(value);
    map['source_type'] = Variable<String>(sourceType);
    if (!nullToAbsent || collectedById != null) {
      map['collected_by_id'] = Variable<String>(collectedById);
    }
    if (!nullToAbsent || collectedByName != null) {
      map['collected_by_name'] = Variable<String>(collectedByName);
    }
    map['collected_at'] = Variable<DateTime>(collectedAt);
    if (!nullToAbsent || supersedesId != null) {
      map['supersedes_id'] = Variable<String>(supersedesId);
    }
    if (!nullToAbsent || carriedFromId != null) {
      map['carried_from_id'] = Variable<String>(carriedFromId);
    }
    map['is_current'] = Variable<bool>(isCurrent);
    if (!nullToAbsent || conflictWithId != null) {
      map['conflict_with_id'] = Variable<String>(conflictWithId);
    }
    return map;
  }

  FieldValuesCompanion toCompanion(bool nullToAbsent) {
    return FieldValuesCompanion(
      id: Value(id),
      entityType: Value(entityType),
      entityId: Value(entityId),
      fieldKey: Value(fieldKey),
      value: Value(value),
      sourceType: Value(sourceType),
      collectedById: collectedById == null && nullToAbsent
          ? const Value.absent()
          : Value(collectedById),
      collectedByName: collectedByName == null && nullToAbsent
          ? const Value.absent()
          : Value(collectedByName),
      collectedAt: Value(collectedAt),
      supersedesId: supersedesId == null && nullToAbsent
          ? const Value.absent()
          : Value(supersedesId),
      carriedFromId: carriedFromId == null && nullToAbsent
          ? const Value.absent()
          : Value(carriedFromId),
      isCurrent: Value(isCurrent),
      conflictWithId: conflictWithId == null && nullToAbsent
          ? const Value.absent()
          : Value(conflictWithId),
    );
  }

  factory FieldValueRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldValueRow(
      id: serializer.fromJson<String>(json['id']),
      entityType: serializer.fromJson<String>(json['entityType']),
      entityId: serializer.fromJson<String>(json['entityId']),
      fieldKey: serializer.fromJson<String>(json['fieldKey']),
      value: serializer.fromJson<String>(json['value']),
      sourceType: serializer.fromJson<String>(json['sourceType']),
      collectedById: serializer.fromJson<String?>(json['collectedById']),
      collectedByName: serializer.fromJson<String?>(json['collectedByName']),
      collectedAt: serializer.fromJson<DateTime>(json['collectedAt']),
      supersedesId: serializer.fromJson<String?>(json['supersedesId']),
      carriedFromId: serializer.fromJson<String?>(json['carriedFromId']),
      isCurrent: serializer.fromJson<bool>(json['isCurrent']),
      conflictWithId: serializer.fromJson<String?>(json['conflictWithId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'entityType': serializer.toJson<String>(entityType),
      'entityId': serializer.toJson<String>(entityId),
      'fieldKey': serializer.toJson<String>(fieldKey),
      'value': serializer.toJson<String>(value),
      'sourceType': serializer.toJson<String>(sourceType),
      'collectedById': serializer.toJson<String?>(collectedById),
      'collectedByName': serializer.toJson<String?>(collectedByName),
      'collectedAt': serializer.toJson<DateTime>(collectedAt),
      'supersedesId': serializer.toJson<String?>(supersedesId),
      'carriedFromId': serializer.toJson<String?>(carriedFromId),
      'isCurrent': serializer.toJson<bool>(isCurrent),
      'conflictWithId': serializer.toJson<String?>(conflictWithId),
    };
  }

  FieldValueRow copyWith({
    String? id,
    String? entityType,
    String? entityId,
    String? fieldKey,
    String? value,
    String? sourceType,
    Value<String?> collectedById = const Value.absent(),
    Value<String?> collectedByName = const Value.absent(),
    DateTime? collectedAt,
    Value<String?> supersedesId = const Value.absent(),
    Value<String?> carriedFromId = const Value.absent(),
    bool? isCurrent,
    Value<String?> conflictWithId = const Value.absent(),
  }) => FieldValueRow(
    id: id ?? this.id,
    entityType: entityType ?? this.entityType,
    entityId: entityId ?? this.entityId,
    fieldKey: fieldKey ?? this.fieldKey,
    value: value ?? this.value,
    sourceType: sourceType ?? this.sourceType,
    collectedById: collectedById.present
        ? collectedById.value
        : this.collectedById,
    collectedByName: collectedByName.present
        ? collectedByName.value
        : this.collectedByName,
    collectedAt: collectedAt ?? this.collectedAt,
    supersedesId: supersedesId.present ? supersedesId.value : this.supersedesId,
    carriedFromId: carriedFromId.present
        ? carriedFromId.value
        : this.carriedFromId,
    isCurrent: isCurrent ?? this.isCurrent,
    conflictWithId: conflictWithId.present
        ? conflictWithId.value
        : this.conflictWithId,
  );
  FieldValueRow copyWithCompanion(FieldValuesCompanion data) {
    return FieldValueRow(
      id: data.id.present ? data.id.value : this.id,
      entityType: data.entityType.present
          ? data.entityType.value
          : this.entityType,
      entityId: data.entityId.present ? data.entityId.value : this.entityId,
      fieldKey: data.fieldKey.present ? data.fieldKey.value : this.fieldKey,
      value: data.value.present ? data.value.value : this.value,
      sourceType: data.sourceType.present
          ? data.sourceType.value
          : this.sourceType,
      collectedById: data.collectedById.present
          ? data.collectedById.value
          : this.collectedById,
      collectedByName: data.collectedByName.present
          ? data.collectedByName.value
          : this.collectedByName,
      collectedAt: data.collectedAt.present
          ? data.collectedAt.value
          : this.collectedAt,
      supersedesId: data.supersedesId.present
          ? data.supersedesId.value
          : this.supersedesId,
      carriedFromId: data.carriedFromId.present
          ? data.carriedFromId.value
          : this.carriedFromId,
      isCurrent: data.isCurrent.present ? data.isCurrent.value : this.isCurrent,
      conflictWithId: data.conflictWithId.present
          ? data.conflictWithId.value
          : this.conflictWithId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldValueRow(')
          ..write('id: $id, ')
          ..write('entityType: $entityType, ')
          ..write('entityId: $entityId, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('value: $value, ')
          ..write('sourceType: $sourceType, ')
          ..write('collectedById: $collectedById, ')
          ..write('collectedByName: $collectedByName, ')
          ..write('collectedAt: $collectedAt, ')
          ..write('supersedesId: $supersedesId, ')
          ..write('carriedFromId: $carriedFromId, ')
          ..write('isCurrent: $isCurrent, ')
          ..write('conflictWithId: $conflictWithId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    entityType,
    entityId,
    fieldKey,
    value,
    sourceType,
    collectedById,
    collectedByName,
    collectedAt,
    supersedesId,
    carriedFromId,
    isCurrent,
    conflictWithId,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldValueRow &&
          other.id == this.id &&
          other.entityType == this.entityType &&
          other.entityId == this.entityId &&
          other.fieldKey == this.fieldKey &&
          other.value == this.value &&
          other.sourceType == this.sourceType &&
          other.collectedById == this.collectedById &&
          other.collectedByName == this.collectedByName &&
          other.collectedAt == this.collectedAt &&
          other.supersedesId == this.supersedesId &&
          other.carriedFromId == this.carriedFromId &&
          other.isCurrent == this.isCurrent &&
          other.conflictWithId == this.conflictWithId);
}

class FieldValuesCompanion extends UpdateCompanion<FieldValueRow> {
  final Value<String> id;
  final Value<String> entityType;
  final Value<String> entityId;
  final Value<String> fieldKey;
  final Value<String> value;
  final Value<String> sourceType;
  final Value<String?> collectedById;
  final Value<String?> collectedByName;
  final Value<DateTime> collectedAt;
  final Value<String?> supersedesId;
  final Value<String?> carriedFromId;
  final Value<bool> isCurrent;
  final Value<String?> conflictWithId;
  final Value<int> rowid;
  const FieldValuesCompanion({
    this.id = const Value.absent(),
    this.entityType = const Value.absent(),
    this.entityId = const Value.absent(),
    this.fieldKey = const Value.absent(),
    this.value = const Value.absent(),
    this.sourceType = const Value.absent(),
    this.collectedById = const Value.absent(),
    this.collectedByName = const Value.absent(),
    this.collectedAt = const Value.absent(),
    this.supersedesId = const Value.absent(),
    this.carriedFromId = const Value.absent(),
    this.isCurrent = const Value.absent(),
    this.conflictWithId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldValuesCompanion.insert({
    required String id,
    required String entityType,
    required String entityId,
    required String fieldKey,
    required String value,
    required String sourceType,
    this.collectedById = const Value.absent(),
    this.collectedByName = const Value.absent(),
    required DateTime collectedAt,
    this.supersedesId = const Value.absent(),
    this.carriedFromId = const Value.absent(),
    required bool isCurrent,
    this.conflictWithId = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       entityType = Value(entityType),
       entityId = Value(entityId),
       fieldKey = Value(fieldKey),
       value = Value(value),
       sourceType = Value(sourceType),
       collectedAt = Value(collectedAt),
       isCurrent = Value(isCurrent);
  static Insertable<FieldValueRow> custom({
    Expression<String>? id,
    Expression<String>? entityType,
    Expression<String>? entityId,
    Expression<String>? fieldKey,
    Expression<String>? value,
    Expression<String>? sourceType,
    Expression<String>? collectedById,
    Expression<String>? collectedByName,
    Expression<DateTime>? collectedAt,
    Expression<String>? supersedesId,
    Expression<String>? carriedFromId,
    Expression<bool>? isCurrent,
    Expression<String>? conflictWithId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (entityType != null) 'entity_type': entityType,
      if (entityId != null) 'entity_id': entityId,
      if (fieldKey != null) 'field_key': fieldKey,
      if (value != null) 'value': value,
      if (sourceType != null) 'source_type': sourceType,
      if (collectedById != null) 'collected_by_id': collectedById,
      if (collectedByName != null) 'collected_by_name': collectedByName,
      if (collectedAt != null) 'collected_at': collectedAt,
      if (supersedesId != null) 'supersedes_id': supersedesId,
      if (carriedFromId != null) 'carried_from_id': carriedFromId,
      if (isCurrent != null) 'is_current': isCurrent,
      if (conflictWithId != null) 'conflict_with_id': conflictWithId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldValuesCompanion copyWith({
    Value<String>? id,
    Value<String>? entityType,
    Value<String>? entityId,
    Value<String>? fieldKey,
    Value<String>? value,
    Value<String>? sourceType,
    Value<String?>? collectedById,
    Value<String?>? collectedByName,
    Value<DateTime>? collectedAt,
    Value<String?>? supersedesId,
    Value<String?>? carriedFromId,
    Value<bool>? isCurrent,
    Value<String?>? conflictWithId,
    Value<int>? rowid,
  }) {
    return FieldValuesCompanion(
      id: id ?? this.id,
      entityType: entityType ?? this.entityType,
      entityId: entityId ?? this.entityId,
      fieldKey: fieldKey ?? this.fieldKey,
      value: value ?? this.value,
      sourceType: sourceType ?? this.sourceType,
      collectedById: collectedById ?? this.collectedById,
      collectedByName: collectedByName ?? this.collectedByName,
      collectedAt: collectedAt ?? this.collectedAt,
      supersedesId: supersedesId ?? this.supersedesId,
      carriedFromId: carriedFromId ?? this.carriedFromId,
      isCurrent: isCurrent ?? this.isCurrent,
      conflictWithId: conflictWithId ?? this.conflictWithId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (entityType.present) {
      map['entity_type'] = Variable<String>(entityType.value);
    }
    if (entityId.present) {
      map['entity_id'] = Variable<String>(entityId.value);
    }
    if (fieldKey.present) {
      map['field_key'] = Variable<String>(fieldKey.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (sourceType.present) {
      map['source_type'] = Variable<String>(sourceType.value);
    }
    if (collectedById.present) {
      map['collected_by_id'] = Variable<String>(collectedById.value);
    }
    if (collectedByName.present) {
      map['collected_by_name'] = Variable<String>(collectedByName.value);
    }
    if (collectedAt.present) {
      map['collected_at'] = Variable<DateTime>(collectedAt.value);
    }
    if (supersedesId.present) {
      map['supersedes_id'] = Variable<String>(supersedesId.value);
    }
    if (carriedFromId.present) {
      map['carried_from_id'] = Variable<String>(carriedFromId.value);
    }
    if (isCurrent.present) {
      map['is_current'] = Variable<bool>(isCurrent.value);
    }
    if (conflictWithId.present) {
      map['conflict_with_id'] = Variable<String>(conflictWithId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldValuesCompanion(')
          ..write('id: $id, ')
          ..write('entityType: $entityType, ')
          ..write('entityId: $entityId, ')
          ..write('fieldKey: $fieldKey, ')
          ..write('value: $value, ')
          ..write('sourceType: $sourceType, ')
          ..write('collectedById: $collectedById, ')
          ..write('collectedByName: $collectedByName, ')
          ..write('collectedAt: $collectedAt, ')
          ..write('supersedesId: $supersedesId, ')
          ..write('carriedFromId: $carriedFromId, ')
          ..write('isCurrent: $isCurrent, ')
          ..write('conflictWithId: $conflictWithId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $VisitsTable extends Visits with TableInfo<$VisitsTable, VisitRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $VisitsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientIdMeta = const VerificationMeta(
    'clientId',
  );
  @override
  late final GeneratedColumn<String> clientId = GeneratedColumn<String>(
    'client_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _serverIdMeta = const VerificationMeta(
    'serverId',
  );
  @override
  late final GeneratedColumn<String> serverId = GeneratedColumn<String>(
    'server_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways('UNIQUE'),
  );
  static const VerificationMeta _householdIdMeta = const VerificationMeta(
    'householdId',
  );
  @override
  late final GeneratedColumn<String> householdId = GeneratedColumn<String>(
    'household_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _volunteerIdMeta = const VerificationMeta(
    'volunteerId',
  );
  @override
  late final GeneratedColumn<String> volunteerId = GeneratedColumn<String>(
    'volunteer_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _startedAtMeta = const VerificationMeta(
    'startedAt',
  );
  @override
  late final GeneratedColumn<DateTime> startedAt = GeneratedColumn<DateTime>(
    'started_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _completedAtMeta = const VerificationMeta(
    'completedAt',
  );
  @override
  late final GeneratedColumn<DateTime> completedAt = GeneratedColumn<DateTime>(
    'completed_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _outcomeMeta = const VerificationMeta(
    'outcome',
  );
  @override
  late final GeneratedColumn<String> outcome = GeneratedColumn<String>(
    'outcome',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _formVersionMeta = const VerificationMeta(
    'formVersion',
  );
  @override
  late final GeneratedColumn<String> formVersion = GeneratedColumn<String>(
    'form_version',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _notesMeta = const VerificationMeta('notes');
  @override
  late final GeneratedColumn<String> notes = GeneratedColumn<String>(
    'notes',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _correctsVisitIdMeta = const VerificationMeta(
    'correctsVisitId',
  );
  @override
  late final GeneratedColumn<String> correctsVisitId = GeneratedColumn<String>(
    'corrects_visit_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  late final GeneratedColumnWithTypeConverter<List<String>, String>
  memberIdsMet = GeneratedColumn<String>(
    'member_ids_met',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  ).withConverter<List<String>>($VisitsTable.$convertermemberIdsMet);
  @override
  List<GeneratedColumn> get $columns => [
    clientId,
    serverId,
    householdId,
    volunteerId,
    startedAt,
    completedAt,
    outcome,
    formVersion,
    notes,
    correctsVisitId,
    memberIdsMet,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'visits';
  @override
  VerificationContext validateIntegrity(
    Insertable<VisitRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_id')) {
      context.handle(
        _clientIdMeta,
        clientId.isAcceptableOrUnknown(data['client_id']!, _clientIdMeta),
      );
    } else if (isInserting) {
      context.missing(_clientIdMeta);
    }
    if (data.containsKey('server_id')) {
      context.handle(
        _serverIdMeta,
        serverId.isAcceptableOrUnknown(data['server_id']!, _serverIdMeta),
      );
    }
    if (data.containsKey('household_id')) {
      context.handle(
        _householdIdMeta,
        householdId.isAcceptableOrUnknown(
          data['household_id']!,
          _householdIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_householdIdMeta);
    }
    if (data.containsKey('volunteer_id')) {
      context.handle(
        _volunteerIdMeta,
        volunteerId.isAcceptableOrUnknown(
          data['volunteer_id']!,
          _volunteerIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_volunteerIdMeta);
    }
    if (data.containsKey('started_at')) {
      context.handle(
        _startedAtMeta,
        startedAt.isAcceptableOrUnknown(data['started_at']!, _startedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_startedAtMeta);
    }
    if (data.containsKey('completed_at')) {
      context.handle(
        _completedAtMeta,
        completedAt.isAcceptableOrUnknown(
          data['completed_at']!,
          _completedAtMeta,
        ),
      );
    }
    if (data.containsKey('outcome')) {
      context.handle(
        _outcomeMeta,
        outcome.isAcceptableOrUnknown(data['outcome']!, _outcomeMeta),
      );
    } else if (isInserting) {
      context.missing(_outcomeMeta);
    }
    if (data.containsKey('form_version')) {
      context.handle(
        _formVersionMeta,
        formVersion.isAcceptableOrUnknown(
          data['form_version']!,
          _formVersionMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_formVersionMeta);
    }
    if (data.containsKey('notes')) {
      context.handle(
        _notesMeta,
        notes.isAcceptableOrUnknown(data['notes']!, _notesMeta),
      );
    }
    if (data.containsKey('corrects_visit_id')) {
      context.handle(
        _correctsVisitIdMeta,
        correctsVisitId.isAcceptableOrUnknown(
          data['corrects_visit_id']!,
          _correctsVisitIdMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientId};
  @override
  VisitRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return VisitRow(
      clientId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_id'],
      )!,
      serverId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}server_id'],
      ),
      householdId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}household_id'],
      )!,
      volunteerId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}volunteer_id'],
      )!,
      startedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}started_at'],
      )!,
      completedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}completed_at'],
      ),
      outcome: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}outcome'],
      )!,
      formVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}form_version'],
      )!,
      notes: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}notes'],
      ),
      correctsVisitId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}corrects_visit_id'],
      ),
      memberIdsMet: $VisitsTable.$convertermemberIdsMet.fromSql(
        attachedDatabase.typeMapping.read(
          DriftSqlType.string,
          data['${effectivePrefix}member_ids_met'],
        )!,
      ),
    );
  }

  @override
  $VisitsTable createAlias(String alias) {
    return $VisitsTable(attachedDatabase, alias);
  }

  static TypeConverter<List<String>, String> $convertermemberIdsMet =
      const StringListConverter();
}

class VisitRow extends DataClass implements Insertable<VisitRow> {
  final String clientId;
  final String? serverId;
  final String householdId;
  final String volunteerId;
  final DateTime startedAt;
  final DateTime? completedAt;
  final String outcome;
  final String formVersion;
  final String? notes;
  final String? correctsVisitId;
  final List<String> memberIdsMet;
  const VisitRow({
    required this.clientId,
    this.serverId,
    required this.householdId,
    required this.volunteerId,
    required this.startedAt,
    this.completedAt,
    required this.outcome,
    required this.formVersion,
    this.notes,
    this.correctsVisitId,
    required this.memberIdsMet,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_id'] = Variable<String>(clientId);
    if (!nullToAbsent || serverId != null) {
      map['server_id'] = Variable<String>(serverId);
    }
    map['household_id'] = Variable<String>(householdId);
    map['volunteer_id'] = Variable<String>(volunteerId);
    map['started_at'] = Variable<DateTime>(startedAt);
    if (!nullToAbsent || completedAt != null) {
      map['completed_at'] = Variable<DateTime>(completedAt);
    }
    map['outcome'] = Variable<String>(outcome);
    map['form_version'] = Variable<String>(formVersion);
    if (!nullToAbsent || notes != null) {
      map['notes'] = Variable<String>(notes);
    }
    if (!nullToAbsent || correctsVisitId != null) {
      map['corrects_visit_id'] = Variable<String>(correctsVisitId);
    }
    {
      map['member_ids_met'] = Variable<String>(
        $VisitsTable.$convertermemberIdsMet.toSql(memberIdsMet),
      );
    }
    return map;
  }

  VisitsCompanion toCompanion(bool nullToAbsent) {
    return VisitsCompanion(
      clientId: Value(clientId),
      serverId: serverId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverId),
      householdId: Value(householdId),
      volunteerId: Value(volunteerId),
      startedAt: Value(startedAt),
      completedAt: completedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(completedAt),
      outcome: Value(outcome),
      formVersion: Value(formVersion),
      notes: notes == null && nullToAbsent
          ? const Value.absent()
          : Value(notes),
      correctsVisitId: correctsVisitId == null && nullToAbsent
          ? const Value.absent()
          : Value(correctsVisitId),
      memberIdsMet: Value(memberIdsMet),
    );
  }

  factory VisitRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return VisitRow(
      clientId: serializer.fromJson<String>(json['clientId']),
      serverId: serializer.fromJson<String?>(json['serverId']),
      householdId: serializer.fromJson<String>(json['householdId']),
      volunteerId: serializer.fromJson<String>(json['volunteerId']),
      startedAt: serializer.fromJson<DateTime>(json['startedAt']),
      completedAt: serializer.fromJson<DateTime?>(json['completedAt']),
      outcome: serializer.fromJson<String>(json['outcome']),
      formVersion: serializer.fromJson<String>(json['formVersion']),
      notes: serializer.fromJson<String?>(json['notes']),
      correctsVisitId: serializer.fromJson<String?>(json['correctsVisitId']),
      memberIdsMet: serializer.fromJson<List<String>>(json['memberIdsMet']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientId': serializer.toJson<String>(clientId),
      'serverId': serializer.toJson<String?>(serverId),
      'householdId': serializer.toJson<String>(householdId),
      'volunteerId': serializer.toJson<String>(volunteerId),
      'startedAt': serializer.toJson<DateTime>(startedAt),
      'completedAt': serializer.toJson<DateTime?>(completedAt),
      'outcome': serializer.toJson<String>(outcome),
      'formVersion': serializer.toJson<String>(formVersion),
      'notes': serializer.toJson<String?>(notes),
      'correctsVisitId': serializer.toJson<String?>(correctsVisitId),
      'memberIdsMet': serializer.toJson<List<String>>(memberIdsMet),
    };
  }

  VisitRow copyWith({
    String? clientId,
    Value<String?> serverId = const Value.absent(),
    String? householdId,
    String? volunteerId,
    DateTime? startedAt,
    Value<DateTime?> completedAt = const Value.absent(),
    String? outcome,
    String? formVersion,
    Value<String?> notes = const Value.absent(),
    Value<String?> correctsVisitId = const Value.absent(),
    List<String>? memberIdsMet,
  }) => VisitRow(
    clientId: clientId ?? this.clientId,
    serverId: serverId.present ? serverId.value : this.serverId,
    householdId: householdId ?? this.householdId,
    volunteerId: volunteerId ?? this.volunteerId,
    startedAt: startedAt ?? this.startedAt,
    completedAt: completedAt.present ? completedAt.value : this.completedAt,
    outcome: outcome ?? this.outcome,
    formVersion: formVersion ?? this.formVersion,
    notes: notes.present ? notes.value : this.notes,
    correctsVisitId: correctsVisitId.present
        ? correctsVisitId.value
        : this.correctsVisitId,
    memberIdsMet: memberIdsMet ?? this.memberIdsMet,
  );
  VisitRow copyWithCompanion(VisitsCompanion data) {
    return VisitRow(
      clientId: data.clientId.present ? data.clientId.value : this.clientId,
      serverId: data.serverId.present ? data.serverId.value : this.serverId,
      householdId: data.householdId.present
          ? data.householdId.value
          : this.householdId,
      volunteerId: data.volunteerId.present
          ? data.volunteerId.value
          : this.volunteerId,
      startedAt: data.startedAt.present ? data.startedAt.value : this.startedAt,
      completedAt: data.completedAt.present
          ? data.completedAt.value
          : this.completedAt,
      outcome: data.outcome.present ? data.outcome.value : this.outcome,
      formVersion: data.formVersion.present
          ? data.formVersion.value
          : this.formVersion,
      notes: data.notes.present ? data.notes.value : this.notes,
      correctsVisitId: data.correctsVisitId.present
          ? data.correctsVisitId.value
          : this.correctsVisitId,
      memberIdsMet: data.memberIdsMet.present
          ? data.memberIdsMet.value
          : this.memberIdsMet,
    );
  }

  @override
  String toString() {
    return (StringBuffer('VisitRow(')
          ..write('clientId: $clientId, ')
          ..write('serverId: $serverId, ')
          ..write('householdId: $householdId, ')
          ..write('volunteerId: $volunteerId, ')
          ..write('startedAt: $startedAt, ')
          ..write('completedAt: $completedAt, ')
          ..write('outcome: $outcome, ')
          ..write('formVersion: $formVersion, ')
          ..write('notes: $notes, ')
          ..write('correctsVisitId: $correctsVisitId, ')
          ..write('memberIdsMet: $memberIdsMet')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    clientId,
    serverId,
    householdId,
    volunteerId,
    startedAt,
    completedAt,
    outcome,
    formVersion,
    notes,
    correctsVisitId,
    memberIdsMet,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is VisitRow &&
          other.clientId == this.clientId &&
          other.serverId == this.serverId &&
          other.householdId == this.householdId &&
          other.volunteerId == this.volunteerId &&
          other.startedAt == this.startedAt &&
          other.completedAt == this.completedAt &&
          other.outcome == this.outcome &&
          other.formVersion == this.formVersion &&
          other.notes == this.notes &&
          other.correctsVisitId == this.correctsVisitId &&
          other.memberIdsMet == this.memberIdsMet);
}

class VisitsCompanion extends UpdateCompanion<VisitRow> {
  final Value<String> clientId;
  final Value<String?> serverId;
  final Value<String> householdId;
  final Value<String> volunteerId;
  final Value<DateTime> startedAt;
  final Value<DateTime?> completedAt;
  final Value<String> outcome;
  final Value<String> formVersion;
  final Value<String?> notes;
  final Value<String?> correctsVisitId;
  final Value<List<String>> memberIdsMet;
  final Value<int> rowid;
  const VisitsCompanion({
    this.clientId = const Value.absent(),
    this.serverId = const Value.absent(),
    this.householdId = const Value.absent(),
    this.volunteerId = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.completedAt = const Value.absent(),
    this.outcome = const Value.absent(),
    this.formVersion = const Value.absent(),
    this.notes = const Value.absent(),
    this.correctsVisitId = const Value.absent(),
    this.memberIdsMet = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  VisitsCompanion.insert({
    required String clientId,
    this.serverId = const Value.absent(),
    required String householdId,
    required String volunteerId,
    required DateTime startedAt,
    this.completedAt = const Value.absent(),
    required String outcome,
    required String formVersion,
    this.notes = const Value.absent(),
    this.correctsVisitId = const Value.absent(),
    required List<String> memberIdsMet,
    this.rowid = const Value.absent(),
  }) : clientId = Value(clientId),
       householdId = Value(householdId),
       volunteerId = Value(volunteerId),
       startedAt = Value(startedAt),
       outcome = Value(outcome),
       formVersion = Value(formVersion),
       memberIdsMet = Value(memberIdsMet);
  static Insertable<VisitRow> custom({
    Expression<String>? clientId,
    Expression<String>? serverId,
    Expression<String>? householdId,
    Expression<String>? volunteerId,
    Expression<DateTime>? startedAt,
    Expression<DateTime>? completedAt,
    Expression<String>? outcome,
    Expression<String>? formVersion,
    Expression<String>? notes,
    Expression<String>? correctsVisitId,
    Expression<String>? memberIdsMet,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientId != null) 'client_id': clientId,
      if (serverId != null) 'server_id': serverId,
      if (householdId != null) 'household_id': householdId,
      if (volunteerId != null) 'volunteer_id': volunteerId,
      if (startedAt != null) 'started_at': startedAt,
      if (completedAt != null) 'completed_at': completedAt,
      if (outcome != null) 'outcome': outcome,
      if (formVersion != null) 'form_version': formVersion,
      if (notes != null) 'notes': notes,
      if (correctsVisitId != null) 'corrects_visit_id': correctsVisitId,
      if (memberIdsMet != null) 'member_ids_met': memberIdsMet,
      if (rowid != null) 'rowid': rowid,
    });
  }

  VisitsCompanion copyWith({
    Value<String>? clientId,
    Value<String?>? serverId,
    Value<String>? householdId,
    Value<String>? volunteerId,
    Value<DateTime>? startedAt,
    Value<DateTime?>? completedAt,
    Value<String>? outcome,
    Value<String>? formVersion,
    Value<String?>? notes,
    Value<String?>? correctsVisitId,
    Value<List<String>>? memberIdsMet,
    Value<int>? rowid,
  }) {
    return VisitsCompanion(
      clientId: clientId ?? this.clientId,
      serverId: serverId ?? this.serverId,
      householdId: householdId ?? this.householdId,
      volunteerId: volunteerId ?? this.volunteerId,
      startedAt: startedAt ?? this.startedAt,
      completedAt: completedAt ?? this.completedAt,
      outcome: outcome ?? this.outcome,
      formVersion: formVersion ?? this.formVersion,
      notes: notes ?? this.notes,
      correctsVisitId: correctsVisitId ?? this.correctsVisitId,
      memberIdsMet: memberIdsMet ?? this.memberIdsMet,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientId.present) {
      map['client_id'] = Variable<String>(clientId.value);
    }
    if (serverId.present) {
      map['server_id'] = Variable<String>(serverId.value);
    }
    if (householdId.present) {
      map['household_id'] = Variable<String>(householdId.value);
    }
    if (volunteerId.present) {
      map['volunteer_id'] = Variable<String>(volunteerId.value);
    }
    if (startedAt.present) {
      map['started_at'] = Variable<DateTime>(startedAt.value);
    }
    if (completedAt.present) {
      map['completed_at'] = Variable<DateTime>(completedAt.value);
    }
    if (outcome.present) {
      map['outcome'] = Variable<String>(outcome.value);
    }
    if (formVersion.present) {
      map['form_version'] = Variable<String>(formVersion.value);
    }
    if (notes.present) {
      map['notes'] = Variable<String>(notes.value);
    }
    if (correctsVisitId.present) {
      map['corrects_visit_id'] = Variable<String>(correctsVisitId.value);
    }
    if (memberIdsMet.present) {
      map['member_ids_met'] = Variable<String>(
        $VisitsTable.$convertermemberIdsMet.toSql(memberIdsMet.value),
      );
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('VisitsCompanion(')
          ..write('clientId: $clientId, ')
          ..write('serverId: $serverId, ')
          ..write('householdId: $householdId, ')
          ..write('volunteerId: $volunteerId, ')
          ..write('startedAt: $startedAt, ')
          ..write('completedAt: $completedAt, ')
          ..write('outcome: $outcome, ')
          ..write('formVersion: $formVersion, ')
          ..write('notes: $notes, ')
          ..write('correctsVisitId: $correctsVisitId, ')
          ..write('memberIdsMet: $memberIdsMet, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncMetaTable extends SyncMeta
    with TableInfo<$SyncMetaTable, SyncMetaRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncMetaTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_meta';
  @override
  VerificationContext validateIntegrity(
    Insertable<SyncMetaRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  SyncMetaRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncMetaRow(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $SyncMetaTable createAlias(String alias) {
    return $SyncMetaTable(attachedDatabase, alias);
  }
}

class SyncMetaRow extends DataClass implements Insertable<SyncMetaRow> {
  final String key;
  final String value;
  const SyncMetaRow({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  SyncMetaCompanion toCompanion(bool nullToAbsent) {
    return SyncMetaCompanion(key: Value(key), value: Value(value));
  }

  factory SyncMetaRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncMetaRow(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  SyncMetaRow copyWith({String? key, String? value}) =>
      SyncMetaRow(key: key ?? this.key, value: value ?? this.value);
  SyncMetaRow copyWithCompanion(SyncMetaCompanion data) {
    return SyncMetaRow(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetaRow(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncMetaRow &&
          other.key == this.key &&
          other.value == this.value);
}

class SyncMetaCompanion extends UpdateCompanion<SyncMetaRow> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const SyncMetaCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncMetaCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<SyncMetaRow> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncMetaCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return SyncMetaCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetaCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PendingMutationsTable extends PendingMutations
    with TableInfo<$PendingMutationsTable, PendingMutationRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingMutationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways('UNIQUE'),
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _householdIdMeta = const VerificationMeta(
    'householdId',
  );
  @override
  late final GeneratedColumn<String> householdId = GeneratedColumn<String>(
    'household_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('pending'),
  );
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _nextAttemptAtMeta = const VerificationMeta(
    'nextAttemptAt',
  );
  @override
  late final GeneratedColumn<DateTime> nextAttemptAt =
      GeneratedColumn<DateTime>(
        'next_attempt_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    key,
    type,
    householdId,
    payload,
    status,
    attempts,
    nextAttemptAt,
    lastError,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_mutation';
  @override
  VerificationContext validateIntegrity(
    Insertable<PendingMutationRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('household_id')) {
      context.handle(
        _householdIdMeta,
        householdId.isAcceptableOrUnknown(
          data['household_id']!,
          _householdIdMeta,
        ),
      );
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('next_attempt_at')) {
      context.handle(
        _nextAttemptAtMeta,
        nextAttemptAt.isAcceptableOrUnknown(
          data['next_attempt_at']!,
          _nextAttemptAtMeta,
        ),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PendingMutationRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingMutationRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      householdId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}household_id'],
      ),
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      nextAttemptAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}next_attempt_at'],
      ),
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
    );
  }

  @override
  $PendingMutationsTable createAlias(String alias) {
    return $PendingMutationsTable(attachedDatabase, alias);
  }
}

class PendingMutationRow extends DataClass
    implements Insertable<PendingMutationRow> {
  /// Push order.
  final int id;

  /// The idempotency key sent with it: the same change is never applied
  /// twice, however often it is retried.
  final String key;

  /// `field.change`, `visit.create`, … (the API's mutation types).
  final String type;

  /// The household the change is about (for a member, their household), so
  /// the households list can show it as "On phone" (schema version 2).
  final String? householdId;

  /// JSON.
  final String payload;

  /// `pending`, `syncing`, `conflict` or `failed`.
  final String status;
  final int attempts;
  final DateTime? nextAttemptAt;

  /// An API error code, never the payload.
  final String? lastError;
  final DateTime createdAt;
  const PendingMutationRow({
    required this.id,
    required this.key,
    required this.type,
    this.householdId,
    required this.payload,
    required this.status,
    required this.attempts,
    this.nextAttemptAt,
    this.lastError,
    required this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['key'] = Variable<String>(key);
    map['type'] = Variable<String>(type);
    if (!nullToAbsent || householdId != null) {
      map['household_id'] = Variable<String>(householdId);
    }
    map['payload'] = Variable<String>(payload);
    map['status'] = Variable<String>(status);
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || nextAttemptAt != null) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt);
    }
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  PendingMutationsCompanion toCompanion(bool nullToAbsent) {
    return PendingMutationsCompanion(
      id: Value(id),
      key: Value(key),
      type: Value(type),
      householdId: householdId == null && nullToAbsent
          ? const Value.absent()
          : Value(householdId),
      payload: Value(payload),
      status: Value(status),
      attempts: Value(attempts),
      nextAttemptAt: nextAttemptAt == null && nullToAbsent
          ? const Value.absent()
          : Value(nextAttemptAt),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      createdAt: Value(createdAt),
    );
  }

  factory PendingMutationRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingMutationRow(
      id: serializer.fromJson<int>(json['id']),
      key: serializer.fromJson<String>(json['key']),
      type: serializer.fromJson<String>(json['type']),
      householdId: serializer.fromJson<String?>(json['householdId']),
      payload: serializer.fromJson<String>(json['payload']),
      status: serializer.fromJson<String>(json['status']),
      attempts: serializer.fromJson<int>(json['attempts']),
      nextAttemptAt: serializer.fromJson<DateTime?>(json['nextAttemptAt']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'key': serializer.toJson<String>(key),
      'type': serializer.toJson<String>(type),
      'householdId': serializer.toJson<String?>(householdId),
      'payload': serializer.toJson<String>(payload),
      'status': serializer.toJson<String>(status),
      'attempts': serializer.toJson<int>(attempts),
      'nextAttemptAt': serializer.toJson<DateTime?>(nextAttemptAt),
      'lastError': serializer.toJson<String?>(lastError),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  PendingMutationRow copyWith({
    int? id,
    String? key,
    String? type,
    Value<String?> householdId = const Value.absent(),
    String? payload,
    String? status,
    int? attempts,
    Value<DateTime?> nextAttemptAt = const Value.absent(),
    Value<String?> lastError = const Value.absent(),
    DateTime? createdAt,
  }) => PendingMutationRow(
    id: id ?? this.id,
    key: key ?? this.key,
    type: type ?? this.type,
    householdId: householdId.present ? householdId.value : this.householdId,
    payload: payload ?? this.payload,
    status: status ?? this.status,
    attempts: attempts ?? this.attempts,
    nextAttemptAt: nextAttemptAt.present
        ? nextAttemptAt.value
        : this.nextAttemptAt,
    lastError: lastError.present ? lastError.value : this.lastError,
    createdAt: createdAt ?? this.createdAt,
  );
  PendingMutationRow copyWithCompanion(PendingMutationsCompanion data) {
    return PendingMutationRow(
      id: data.id.present ? data.id.value : this.id,
      key: data.key.present ? data.key.value : this.key,
      type: data.type.present ? data.type.value : this.type,
      householdId: data.householdId.present
          ? data.householdId.value
          : this.householdId,
      payload: data.payload.present ? data.payload.value : this.payload,
      status: data.status.present ? data.status.value : this.status,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      nextAttemptAt: data.nextAttemptAt.present
          ? data.nextAttemptAt.value
          : this.nextAttemptAt,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingMutationRow(')
          ..write('id: $id, ')
          ..write('key: $key, ')
          ..write('type: $type, ')
          ..write('householdId: $householdId, ')
          ..write('payload: $payload, ')
          ..write('status: $status, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('lastError: $lastError, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    key,
    type,
    householdId,
    payload,
    status,
    attempts,
    nextAttemptAt,
    lastError,
    createdAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingMutationRow &&
          other.id == this.id &&
          other.key == this.key &&
          other.type == this.type &&
          other.householdId == this.householdId &&
          other.payload == this.payload &&
          other.status == this.status &&
          other.attempts == this.attempts &&
          other.nextAttemptAt == this.nextAttemptAt &&
          other.lastError == this.lastError &&
          other.createdAt == this.createdAt);
}

class PendingMutationsCompanion extends UpdateCompanion<PendingMutationRow> {
  final Value<int> id;
  final Value<String> key;
  final Value<String> type;
  final Value<String?> householdId;
  final Value<String> payload;
  final Value<String> status;
  final Value<int> attempts;
  final Value<DateTime?> nextAttemptAt;
  final Value<String?> lastError;
  final Value<DateTime> createdAt;
  const PendingMutationsCompanion({
    this.id = const Value.absent(),
    this.key = const Value.absent(),
    this.type = const Value.absent(),
    this.householdId = const Value.absent(),
    this.payload = const Value.absent(),
    this.status = const Value.absent(),
    this.attempts = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.lastError = const Value.absent(),
    this.createdAt = const Value.absent(),
  });
  PendingMutationsCompanion.insert({
    this.id = const Value.absent(),
    required String key,
    required String type,
    this.householdId = const Value.absent(),
    required String payload,
    this.status = const Value.absent(),
    this.attempts = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.lastError = const Value.absent(),
    required DateTime createdAt,
  }) : key = Value(key),
       type = Value(type),
       payload = Value(payload),
       createdAt = Value(createdAt);
  static Insertable<PendingMutationRow> custom({
    Expression<int>? id,
    Expression<String>? key,
    Expression<String>? type,
    Expression<String>? householdId,
    Expression<String>? payload,
    Expression<String>? status,
    Expression<int>? attempts,
    Expression<DateTime>? nextAttemptAt,
    Expression<String>? lastError,
    Expression<DateTime>? createdAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (key != null) 'key': key,
      if (type != null) 'type': type,
      if (householdId != null) 'household_id': householdId,
      if (payload != null) 'payload': payload,
      if (status != null) 'status': status,
      if (attempts != null) 'attempts': attempts,
      if (nextAttemptAt != null) 'next_attempt_at': nextAttemptAt,
      if (lastError != null) 'last_error': lastError,
      if (createdAt != null) 'created_at': createdAt,
    });
  }

  PendingMutationsCompanion copyWith({
    Value<int>? id,
    Value<String>? key,
    Value<String>? type,
    Value<String?>? householdId,
    Value<String>? payload,
    Value<String>? status,
    Value<int>? attempts,
    Value<DateTime?>? nextAttemptAt,
    Value<String?>? lastError,
    Value<DateTime>? createdAt,
  }) {
    return PendingMutationsCompanion(
      id: id ?? this.id,
      key: key ?? this.key,
      type: type ?? this.type,
      householdId: householdId ?? this.householdId,
      payload: payload ?? this.payload,
      status: status ?? this.status,
      attempts: attempts ?? this.attempts,
      nextAttemptAt: nextAttemptAt ?? this.nextAttemptAt,
      lastError: lastError ?? this.lastError,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (householdId.present) {
      map['household_id'] = Variable<String>(householdId.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (nextAttemptAt.present) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingMutationsCompanion(')
          ..write('id: $id, ')
          ..write('key: $key, ')
          ..write('type: $type, ')
          ..write('householdId: $householdId, ')
          ..write('payload: $payload, ')
          ..write('status: $status, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('lastError: $lastError, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $FieldDefinitionsTable fieldDefinitions = $FieldDefinitionsTable(
    this,
  );
  late final $HouseholdsTable households = $HouseholdsTable(this);
  late final $VotersTable voters = $VotersTable(this);
  late final $FieldValuesTable fieldValues = $FieldValuesTable(this);
  late final $VisitsTable visits = $VisitsTable(this);
  late final $SyncMetaTable syncMeta = $SyncMetaTable(this);
  late final $PendingMutationsTable pendingMutations = $PendingMutationsTable(
    this,
  );
  late final Index householdsStation = Index(
    'households_station',
    'CREATE INDEX households_station ON households (polling_station_id)',
  );
  late final Index votersHousehold = Index(
    'voters_household',
    'CREATE INDEX voters_household ON voters (household_id)',
  );
  late final Index fieldValuesEntity = Index(
    'field_values_entity',
    'CREATE INDEX field_values_entity ON field_values (entity_id, field_key)',
  );
  late final Index visitsHousehold = Index(
    'visits_household',
    'CREATE INDEX visits_household ON visits (household_id)',
  );
  late final Index pendingMutationStatus = Index(
    'pending_mutation_status',
    'CREATE INDEX pending_mutation_status ON pending_mutation (status)',
  );
  late final Index pendingMutationHousehold = Index(
    'pending_mutation_household',
    'CREATE INDEX pending_mutation_household ON pending_mutation (household_id)',
  );
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    fieldDefinitions,
    households,
    voters,
    fieldValues,
    visits,
    syncMeta,
    pendingMutations,
    householdsStation,
    votersHousehold,
    fieldValuesEntity,
    visitsHousehold,
    pendingMutationStatus,
    pendingMutationHousehold,
  ];
}

typedef $$FieldDefinitionsTableCreateCompanionBuilder =
    FieldDefinitionsCompanion Function({
      required String id,
      required String key,
      required String labelKey,
      required String appliesTo,
      required String type,
      Value<String?> options,
      required bool isRestricted,
      required bool requiresConsent,
      required bool enabled,
      required String purpose,
      Value<int> rowid,
    });
typedef $$FieldDefinitionsTableUpdateCompanionBuilder =
    FieldDefinitionsCompanion Function({
      Value<String> id,
      Value<String> key,
      Value<String> labelKey,
      Value<String> appliesTo,
      Value<String> type,
      Value<String?> options,
      Value<bool> isRestricted,
      Value<bool> requiresConsent,
      Value<bool> enabled,
      Value<String> purpose,
      Value<int> rowid,
    });

class $$FieldDefinitionsTableFilterComposer
    extends Composer<_$AppDatabase, $FieldDefinitionsTable> {
  $$FieldDefinitionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get labelKey => $composableBuilder(
    column: $table.labelKey,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get appliesTo => $composableBuilder(
    column: $table.appliesTo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get options => $composableBuilder(
    column: $table.options,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isRestricted => $composableBuilder(
    column: $table.isRestricted,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get requiresConsent => $composableBuilder(
    column: $table.requiresConsent,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get enabled => $composableBuilder(
    column: $table.enabled,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get purpose => $composableBuilder(
    column: $table.purpose,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldDefinitionsTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldDefinitionsTable> {
  $$FieldDefinitionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get labelKey => $composableBuilder(
    column: $table.labelKey,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get appliesTo => $composableBuilder(
    column: $table.appliesTo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get options => $composableBuilder(
    column: $table.options,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isRestricted => $composableBuilder(
    column: $table.isRestricted,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get requiresConsent => $composableBuilder(
    column: $table.requiresConsent,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get enabled => $composableBuilder(
    column: $table.enabled,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get purpose => $composableBuilder(
    column: $table.purpose,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldDefinitionsTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldDefinitionsTable> {
  $$FieldDefinitionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get labelKey =>
      $composableBuilder(column: $table.labelKey, builder: (column) => column);

  GeneratedColumn<String> get appliesTo =>
      $composableBuilder(column: $table.appliesTo, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get options =>
      $composableBuilder(column: $table.options, builder: (column) => column);

  GeneratedColumn<bool> get isRestricted => $composableBuilder(
    column: $table.isRestricted,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get requiresConsent => $composableBuilder(
    column: $table.requiresConsent,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get enabled =>
      $composableBuilder(column: $table.enabled, builder: (column) => column);

  GeneratedColumn<String> get purpose =>
      $composableBuilder(column: $table.purpose, builder: (column) => column);
}

class $$FieldDefinitionsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldDefinitionsTable,
          FieldDefinitionRow,
          $$FieldDefinitionsTableFilterComposer,
          $$FieldDefinitionsTableOrderingComposer,
          $$FieldDefinitionsTableAnnotationComposer,
          $$FieldDefinitionsTableCreateCompanionBuilder,
          $$FieldDefinitionsTableUpdateCompanionBuilder,
          (
            FieldDefinitionRow,
            BaseReferences<
              _$AppDatabase,
              $FieldDefinitionsTable,
              FieldDefinitionRow
            >,
          ),
          FieldDefinitionRow,
          PrefetchHooks Function()
        > {
  $$FieldDefinitionsTableTableManager(
    _$AppDatabase db,
    $FieldDefinitionsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldDefinitionsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldDefinitionsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldDefinitionsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> key = const Value.absent(),
                Value<String> labelKey = const Value.absent(),
                Value<String> appliesTo = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<String?> options = const Value.absent(),
                Value<bool> isRestricted = const Value.absent(),
                Value<bool> requiresConsent = const Value.absent(),
                Value<bool> enabled = const Value.absent(),
                Value<String> purpose = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldDefinitionsCompanion(
                id: id,
                key: key,
                labelKey: labelKey,
                appliesTo: appliesTo,
                type: type,
                options: options,
                isRestricted: isRestricted,
                requiresConsent: requiresConsent,
                enabled: enabled,
                purpose: purpose,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String key,
                required String labelKey,
                required String appliesTo,
                required String type,
                Value<String?> options = const Value.absent(),
                required bool isRestricted,
                required bool requiresConsent,
                required bool enabled,
                required String purpose,
                Value<int> rowid = const Value.absent(),
              }) => FieldDefinitionsCompanion.insert(
                id: id,
                key: key,
                labelKey: labelKey,
                appliesTo: appliesTo,
                type: type,
                options: options,
                isRestricted: isRestricted,
                requiresConsent: requiresConsent,
                enabled: enabled,
                purpose: purpose,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldDefinitionsTable, FieldDefinitionRow>(
                    table,
                  ),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldDefinitionsTable,
                    FieldDefinitionRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldDefinitionsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldDefinitionsTable,
      FieldDefinitionRow,
      $$FieldDefinitionsTableFilterComposer,
      $$FieldDefinitionsTableOrderingComposer,
      $$FieldDefinitionsTableAnnotationComposer,
      $$FieldDefinitionsTableCreateCompanionBuilder,
      $$FieldDefinitionsTableUpdateCompanionBuilder,
      (
        FieldDefinitionRow,
        BaseReferences<
          _$AppDatabase,
          $FieldDefinitionsTable,
          FieldDefinitionRow
        >,
      ),
      FieldDefinitionRow,
      PrefetchHooks Function()
    >;
typedef $$HouseholdsTableCreateCompanionBuilder = HouseholdsCompanion Function({
  required String id,
  required String partId,
  required String pollingStationId,
  required String displayAddress,
  required String houseKey,
  Value<String?> structuredAddress,
  Value<double?> latitude,
  Value<double?> longitude,
  Value<double?> accuracyM,
  Value<DateTime?> locationCapturedAt,
  required String origin,
  required String status,
  Value<int> rowid,
});
typedef $$HouseholdsTableUpdateCompanionBuilder = HouseholdsCompanion Function({
  Value<String> id,
  Value<String> partId,
  Value<String> pollingStationId,
  Value<String> displayAddress,
  Value<String> houseKey,
  Value<String?> structuredAddress,
  Value<double?> latitude,
  Value<double?> longitude,
  Value<double?> accuracyM,
  Value<DateTime?> locationCapturedAt,
  Value<String> origin,
  Value<String> status,
  Value<int> rowid,
});

class $$HouseholdsTableFilterComposer
    extends Composer<_$AppDatabase, $HouseholdsTable> {
  $$HouseholdsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get partId => $composableBuilder(
    column: $table.partId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get pollingStationId => $composableBuilder(
    column: $table.pollingStationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get displayAddress => $composableBuilder(
    column: $table.displayAddress,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get houseKey => $composableBuilder(
    column: $table.houseKey,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get structuredAddress => $composableBuilder(
    column: $table.structuredAddress,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get latitude => $composableBuilder(
    column: $table.latitude,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get longitude => $composableBuilder(
    column: $table.longitude,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get accuracyM => $composableBuilder(
    column: $table.accuracyM,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get locationCapturedAt => $composableBuilder(
    column: $table.locationCapturedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get origin => $composableBuilder(
    column: $table.origin,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );
}

class $$HouseholdsTableOrderingComposer
    extends Composer<_$AppDatabase, $HouseholdsTable> {
  $$HouseholdsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get partId => $composableBuilder(
    column: $table.partId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get pollingStationId => $composableBuilder(
    column: $table.pollingStationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get displayAddress => $composableBuilder(
    column: $table.displayAddress,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get houseKey => $composableBuilder(
    column: $table.houseKey,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get structuredAddress => $composableBuilder(
    column: $table.structuredAddress,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get latitude => $composableBuilder(
    column: $table.latitude,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get longitude => $composableBuilder(
    column: $table.longitude,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get accuracyM => $composableBuilder(
    column: $table.accuracyM,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get locationCapturedAt => $composableBuilder(
    column: $table.locationCapturedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get origin => $composableBuilder(
    column: $table.origin,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$HouseholdsTableAnnotationComposer
    extends Composer<_$AppDatabase, $HouseholdsTable> {
  $$HouseholdsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get partId =>
      $composableBuilder(column: $table.partId, builder: (column) => column);

  GeneratedColumn<String> get pollingStationId => $composableBuilder(
    column: $table.pollingStationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get displayAddress => $composableBuilder(
    column: $table.displayAddress,
    builder: (column) => column,
  );

  GeneratedColumn<String> get houseKey =>
      $composableBuilder(column: $table.houseKey, builder: (column) => column);

  GeneratedColumn<String> get structuredAddress => $composableBuilder(
    column: $table.structuredAddress,
    builder: (column) => column,
  );

  GeneratedColumn<double> get latitude =>
      $composableBuilder(column: $table.latitude, builder: (column) => column);

  GeneratedColumn<double> get longitude =>
      $composableBuilder(column: $table.longitude, builder: (column) => column);

  GeneratedColumn<double> get accuracyM =>
      $composableBuilder(column: $table.accuracyM, builder: (column) => column);

  GeneratedColumn<DateTime> get locationCapturedAt => $composableBuilder(
    column: $table.locationCapturedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get origin =>
      $composableBuilder(column: $table.origin, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);
}

class $$HouseholdsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $HouseholdsTable,
          HouseholdRow,
          $$HouseholdsTableFilterComposer,
          $$HouseholdsTableOrderingComposer,
          $$HouseholdsTableAnnotationComposer,
          $$HouseholdsTableCreateCompanionBuilder,
          $$HouseholdsTableUpdateCompanionBuilder,
          (
            HouseholdRow,
            BaseReferences<_$AppDatabase, $HouseholdsTable, HouseholdRow>,
          ),
          HouseholdRow,
          PrefetchHooks Function()
        > {
  $$HouseholdsTableTableManager(_$AppDatabase db, $HouseholdsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$HouseholdsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$HouseholdsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$HouseholdsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> partId = const Value.absent(),
                Value<String> pollingStationId = const Value.absent(),
                Value<String> displayAddress = const Value.absent(),
                Value<String> houseKey = const Value.absent(),
                Value<String?> structuredAddress = const Value.absent(),
                Value<double?> latitude = const Value.absent(),
                Value<double?> longitude = const Value.absent(),
                Value<double?> accuracyM = const Value.absent(),
                Value<DateTime?> locationCapturedAt = const Value.absent(),
                Value<String> origin = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => HouseholdsCompanion(
                id: id,
                partId: partId,
                pollingStationId: pollingStationId,
                displayAddress: displayAddress,
                houseKey: houseKey,
                structuredAddress: structuredAddress,
                latitude: latitude,
                longitude: longitude,
                accuracyM: accuracyM,
                locationCapturedAt: locationCapturedAt,
                origin: origin,
                status: status,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String partId,
                required String pollingStationId,
                required String displayAddress,
                required String houseKey,
                Value<String?> structuredAddress = const Value.absent(),
                Value<double?> latitude = const Value.absent(),
                Value<double?> longitude = const Value.absent(),
                Value<double?> accuracyM = const Value.absent(),
                Value<DateTime?> locationCapturedAt = const Value.absent(),
                required String origin,
                required String status,
                Value<int> rowid = const Value.absent(),
              }) => HouseholdsCompanion.insert(
                id: id,
                partId: partId,
                pollingStationId: pollingStationId,
                displayAddress: displayAddress,
                houseKey: houseKey,
                structuredAddress: structuredAddress,
                latitude: latitude,
                longitude: longitude,
                accuracyM: accuracyM,
                locationCapturedAt: locationCapturedAt,
                origin: origin,
                status: status,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$HouseholdsTable, HouseholdRow>(table),
                  BaseReferences<_$AppDatabase, $HouseholdsTable, HouseholdRow>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$HouseholdsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $HouseholdsTable,
      HouseholdRow,
      $$HouseholdsTableFilterComposer,
      $$HouseholdsTableOrderingComposer,
      $$HouseholdsTableAnnotationComposer,
      $$HouseholdsTableCreateCompanionBuilder,
      $$HouseholdsTableUpdateCompanionBuilder,
      (
        HouseholdRow,
        BaseReferences<_$AppDatabase, $HouseholdsTable, HouseholdRow>,
      ),
      HouseholdRow,
      PrefetchHooks Function()
    >;
typedef $$VotersTableCreateCompanionBuilder = VotersCompanion Function({
  required String id,
  required String householdId,
  required String partId,
  required String pollingStationId,
  required String origin,
  required String recordStatus,
  Value<int?> sectionNo,
  Value<int?> serialNo,
  Value<String?> epicNumber,
  required String official,
  required List<String> previousVoterIds,
  Value<int> rowid,
});
typedef $$VotersTableUpdateCompanionBuilder = VotersCompanion Function({
  Value<String> id,
  Value<String> householdId,
  Value<String> partId,
  Value<String> pollingStationId,
  Value<String> origin,
  Value<String> recordStatus,
  Value<int?> sectionNo,
  Value<int?> serialNo,
  Value<String?> epicNumber,
  Value<String> official,
  Value<List<String>> previousVoterIds,
  Value<int> rowid,
});

class $$VotersTableFilterComposer
    extends Composer<_$AppDatabase, $VotersTable> {
  $$VotersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get partId => $composableBuilder(
    column: $table.partId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get pollingStationId => $composableBuilder(
    column: $table.pollingStationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get origin => $composableBuilder(
    column: $table.origin,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get recordStatus => $composableBuilder(
    column: $table.recordStatus,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sectionNo => $composableBuilder(
    column: $table.sectionNo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serialNo => $composableBuilder(
    column: $table.serialNo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get epicNumber => $composableBuilder(
    column: $table.epicNumber,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get official => $composableBuilder(
    column: $table.official,
    builder: (column) => ColumnFilters(column),
  );

  ColumnWithTypeConverterFilters<List<String>, List<String>, String>
  get previousVoterIds => $composableBuilder(
    column: $table.previousVoterIds,
    builder: (column) => ColumnWithTypeConverterFilters(column),
  );
}

class $$VotersTableOrderingComposer
    extends Composer<_$AppDatabase, $VotersTable> {
  $$VotersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get partId => $composableBuilder(
    column: $table.partId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get pollingStationId => $composableBuilder(
    column: $table.pollingStationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get origin => $composableBuilder(
    column: $table.origin,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get recordStatus => $composableBuilder(
    column: $table.recordStatus,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sectionNo => $composableBuilder(
    column: $table.sectionNo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serialNo => $composableBuilder(
    column: $table.serialNo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get epicNumber => $composableBuilder(
    column: $table.epicNumber,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get official => $composableBuilder(
    column: $table.official,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get previousVoterIds => $composableBuilder(
    column: $table.previousVoterIds,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$VotersTableAnnotationComposer
    extends Composer<_$AppDatabase, $VotersTable> {
  $$VotersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get partId =>
      $composableBuilder(column: $table.partId, builder: (column) => column);

  GeneratedColumn<String> get pollingStationId => $composableBuilder(
    column: $table.pollingStationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get origin =>
      $composableBuilder(column: $table.origin, builder: (column) => column);

  GeneratedColumn<String> get recordStatus => $composableBuilder(
    column: $table.recordStatus,
    builder: (column) => column,
  );

  GeneratedColumn<int> get sectionNo =>
      $composableBuilder(column: $table.sectionNo, builder: (column) => column);

  GeneratedColumn<int> get serialNo =>
      $composableBuilder(column: $table.serialNo, builder: (column) => column);

  GeneratedColumn<String> get epicNumber => $composableBuilder(
    column: $table.epicNumber,
    builder: (column) => column,
  );

  GeneratedColumn<String> get official =>
      $composableBuilder(column: $table.official, builder: (column) => column);

  GeneratedColumnWithTypeConverter<List<String>, String> get previousVoterIds =>
      $composableBuilder(
        column: $table.previousVoterIds,
        builder: (column) => column,
      );
}

class $$VotersTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $VotersTable,
          VoterRow,
          $$VotersTableFilterComposer,
          $$VotersTableOrderingComposer,
          $$VotersTableAnnotationComposer,
          $$VotersTableCreateCompanionBuilder,
          $$VotersTableUpdateCompanionBuilder,
          (VoterRow, BaseReferences<_$AppDatabase, $VotersTable, VoterRow>),
          VoterRow,
          PrefetchHooks Function()
        > {
  $$VotersTableTableManager(_$AppDatabase db, $VotersTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$VotersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$VotersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$VotersTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> householdId = const Value.absent(),
                Value<String> partId = const Value.absent(),
                Value<String> pollingStationId = const Value.absent(),
                Value<String> origin = const Value.absent(),
                Value<String> recordStatus = const Value.absent(),
                Value<int?> sectionNo = const Value.absent(),
                Value<int?> serialNo = const Value.absent(),
                Value<String?> epicNumber = const Value.absent(),
                Value<String> official = const Value.absent(),
                Value<List<String>> previousVoterIds = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => VotersCompanion(
                id: id,
                householdId: householdId,
                partId: partId,
                pollingStationId: pollingStationId,
                origin: origin,
                recordStatus: recordStatus,
                sectionNo: sectionNo,
                serialNo: serialNo,
                epicNumber: epicNumber,
                official: official,
                previousVoterIds: previousVoterIds,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String householdId,
                required String partId,
                required String pollingStationId,
                required String origin,
                required String recordStatus,
                Value<int?> sectionNo = const Value.absent(),
                Value<int?> serialNo = const Value.absent(),
                Value<String?> epicNumber = const Value.absent(),
                required String official,
                required List<String> previousVoterIds,
                Value<int> rowid = const Value.absent(),
              }) => VotersCompanion.insert(
                id: id,
                householdId: householdId,
                partId: partId,
                pollingStationId: pollingStationId,
                origin: origin,
                recordStatus: recordStatus,
                sectionNo: sectionNo,
                serialNo: serialNo,
                epicNumber: epicNumber,
                official: official,
                previousVoterIds: previousVoterIds,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$VotersTable, VoterRow>(table),
                  BaseReferences<_$AppDatabase, $VotersTable, VoterRow>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$VotersTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $VotersTable,
      VoterRow,
      $$VotersTableFilterComposer,
      $$VotersTableOrderingComposer,
      $$VotersTableAnnotationComposer,
      $$VotersTableCreateCompanionBuilder,
      $$VotersTableUpdateCompanionBuilder,
      (VoterRow, BaseReferences<_$AppDatabase, $VotersTable, VoterRow>),
      VoterRow,
      PrefetchHooks Function()
    >;
typedef $$FieldValuesTableCreateCompanionBuilder =
    FieldValuesCompanion Function({
      required String id,
      required String entityType,
      required String entityId,
      required String fieldKey,
      required String value,
      required String sourceType,
      Value<String?> collectedById,
      Value<String?> collectedByName,
      required DateTime collectedAt,
      Value<String?> supersedesId,
      Value<String?> carriedFromId,
      required bool isCurrent,
      Value<String?> conflictWithId,
      Value<int> rowid,
    });
typedef $$FieldValuesTableUpdateCompanionBuilder =
    FieldValuesCompanion Function({
      Value<String> id,
      Value<String> entityType,
      Value<String> entityId,
      Value<String> fieldKey,
      Value<String> value,
      Value<String> sourceType,
      Value<String?> collectedById,
      Value<String?> collectedByName,
      Value<DateTime> collectedAt,
      Value<String?> supersedesId,
      Value<String?> carriedFromId,
      Value<bool> isCurrent,
      Value<String?> conflictWithId,
      Value<int> rowid,
    });

class $$FieldValuesTableFilterComposer
    extends Composer<_$AppDatabase, $FieldValuesTable> {
  $$FieldValuesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get entityType => $composableBuilder(
    column: $table.entityType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get entityId => $composableBuilder(
    column: $table.entityId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get fieldKey => $composableBuilder(
    column: $table.fieldKey,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sourceType => $composableBuilder(
    column: $table.sourceType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get collectedById => $composableBuilder(
    column: $table.collectedById,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get collectedByName => $composableBuilder(
    column: $table.collectedByName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get collectedAt => $composableBuilder(
    column: $table.collectedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get supersedesId => $composableBuilder(
    column: $table.supersedesId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get carriedFromId => $composableBuilder(
    column: $table.carriedFromId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isCurrent => $composableBuilder(
    column: $table.isCurrent,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get conflictWithId => $composableBuilder(
    column: $table.conflictWithId,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldValuesTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldValuesTable> {
  $$FieldValuesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get entityType => $composableBuilder(
    column: $table.entityType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get entityId => $composableBuilder(
    column: $table.entityId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get fieldKey => $composableBuilder(
    column: $table.fieldKey,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sourceType => $composableBuilder(
    column: $table.sourceType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get collectedById => $composableBuilder(
    column: $table.collectedById,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get collectedByName => $composableBuilder(
    column: $table.collectedByName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get collectedAt => $composableBuilder(
    column: $table.collectedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get supersedesId => $composableBuilder(
    column: $table.supersedesId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get carriedFromId => $composableBuilder(
    column: $table.carriedFromId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isCurrent => $composableBuilder(
    column: $table.isCurrent,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get conflictWithId => $composableBuilder(
    column: $table.conflictWithId,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldValuesTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldValuesTable> {
  $$FieldValuesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get entityType => $composableBuilder(
    column: $table.entityType,
    builder: (column) => column,
  );

  GeneratedColumn<String> get entityId =>
      $composableBuilder(column: $table.entityId, builder: (column) => column);

  GeneratedColumn<String> get fieldKey =>
      $composableBuilder(column: $table.fieldKey, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);

  GeneratedColumn<String> get sourceType => $composableBuilder(
    column: $table.sourceType,
    builder: (column) => column,
  );

  GeneratedColumn<String> get collectedById => $composableBuilder(
    column: $table.collectedById,
    builder: (column) => column,
  );

  GeneratedColumn<String> get collectedByName => $composableBuilder(
    column: $table.collectedByName,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get collectedAt => $composableBuilder(
    column: $table.collectedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get supersedesId => $composableBuilder(
    column: $table.supersedesId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get carriedFromId => $composableBuilder(
    column: $table.carriedFromId,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get isCurrent =>
      $composableBuilder(column: $table.isCurrent, builder: (column) => column);

  GeneratedColumn<String> get conflictWithId => $composableBuilder(
    column: $table.conflictWithId,
    builder: (column) => column,
  );
}

class $$FieldValuesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldValuesTable,
          FieldValueRow,
          $$FieldValuesTableFilterComposer,
          $$FieldValuesTableOrderingComposer,
          $$FieldValuesTableAnnotationComposer,
          $$FieldValuesTableCreateCompanionBuilder,
          $$FieldValuesTableUpdateCompanionBuilder,
          (
            FieldValueRow,
            BaseReferences<_$AppDatabase, $FieldValuesTable, FieldValueRow>,
          ),
          FieldValueRow,
          PrefetchHooks Function()
        > {
  $$FieldValuesTableTableManager(_$AppDatabase db, $FieldValuesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldValuesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldValuesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldValuesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> entityType = const Value.absent(),
                Value<String> entityId = const Value.absent(),
                Value<String> fieldKey = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<String> sourceType = const Value.absent(),
                Value<String?> collectedById = const Value.absent(),
                Value<String?> collectedByName = const Value.absent(),
                Value<DateTime> collectedAt = const Value.absent(),
                Value<String?> supersedesId = const Value.absent(),
                Value<String?> carriedFromId = const Value.absent(),
                Value<bool> isCurrent = const Value.absent(),
                Value<String?> conflictWithId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldValuesCompanion(
                id: id,
                entityType: entityType,
                entityId: entityId,
                fieldKey: fieldKey,
                value: value,
                sourceType: sourceType,
                collectedById: collectedById,
                collectedByName: collectedByName,
                collectedAt: collectedAt,
                supersedesId: supersedesId,
                carriedFromId: carriedFromId,
                isCurrent: isCurrent,
                conflictWithId: conflictWithId,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String entityType,
                required String entityId,
                required String fieldKey,
                required String value,
                required String sourceType,
                Value<String?> collectedById = const Value.absent(),
                Value<String?> collectedByName = const Value.absent(),
                required DateTime collectedAt,
                Value<String?> supersedesId = const Value.absent(),
                Value<String?> carriedFromId = const Value.absent(),
                required bool isCurrent,
                Value<String?> conflictWithId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldValuesCompanion.insert(
                id: id,
                entityType: entityType,
                entityId: entityId,
                fieldKey: fieldKey,
                value: value,
                sourceType: sourceType,
                collectedById: collectedById,
                collectedByName: collectedByName,
                collectedAt: collectedAt,
                supersedesId: supersedesId,
                carriedFromId: carriedFromId,
                isCurrent: isCurrent,
                conflictWithId: conflictWithId,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldValuesTable, FieldValueRow>(table),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldValuesTable,
                    FieldValueRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldValuesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldValuesTable,
      FieldValueRow,
      $$FieldValuesTableFilterComposer,
      $$FieldValuesTableOrderingComposer,
      $$FieldValuesTableAnnotationComposer,
      $$FieldValuesTableCreateCompanionBuilder,
      $$FieldValuesTableUpdateCompanionBuilder,
      (
        FieldValueRow,
        BaseReferences<_$AppDatabase, $FieldValuesTable, FieldValueRow>,
      ),
      FieldValueRow,
      PrefetchHooks Function()
    >;
typedef $$VisitsTableCreateCompanionBuilder = VisitsCompanion Function({
  required String clientId,
  Value<String?> serverId,
  required String householdId,
  required String volunteerId,
  required DateTime startedAt,
  Value<DateTime?> completedAt,
  required String outcome,
  required String formVersion,
  Value<String?> notes,
  Value<String?> correctsVisitId,
  required List<String> memberIdsMet,
  Value<int> rowid,
});
typedef $$VisitsTableUpdateCompanionBuilder = VisitsCompanion Function({
  Value<String> clientId,
  Value<String?> serverId,
  Value<String> householdId,
  Value<String> volunteerId,
  Value<DateTime> startedAt,
  Value<DateTime?> completedAt,
  Value<String> outcome,
  Value<String> formVersion,
  Value<String?> notes,
  Value<String?> correctsVisitId,
  Value<List<String>> memberIdsMet,
  Value<int> rowid,
});

class $$VisitsTableFilterComposer
    extends Composer<_$AppDatabase, $VisitsTable> {
  $$VisitsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get volunteerId => $composableBuilder(
    column: $table.volunteerId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get startedAt => $composableBuilder(
    column: $table.startedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get completedAt => $composableBuilder(
    column: $table.completedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get outcome => $composableBuilder(
    column: $table.outcome,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get formVersion => $composableBuilder(
    column: $table.formVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get correctsVisitId => $composableBuilder(
    column: $table.correctsVisitId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnWithTypeConverterFilters<List<String>, List<String>, String>
  get memberIdsMet => $composableBuilder(
    column: $table.memberIdsMet,
    builder: (column) => ColumnWithTypeConverterFilters(column),
  );
}

class $$VisitsTableOrderingComposer
    extends Composer<_$AppDatabase, $VisitsTable> {
  $$VisitsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get volunteerId => $composableBuilder(
    column: $table.volunteerId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get startedAt => $composableBuilder(
    column: $table.startedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get completedAt => $composableBuilder(
    column: $table.completedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get outcome => $composableBuilder(
    column: $table.outcome,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get formVersion => $composableBuilder(
    column: $table.formVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get correctsVisitId => $composableBuilder(
    column: $table.correctsVisitId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get memberIdsMet => $composableBuilder(
    column: $table.memberIdsMet,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$VisitsTableAnnotationComposer
    extends Composer<_$AppDatabase, $VisitsTable> {
  $$VisitsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientId =>
      $composableBuilder(column: $table.clientId, builder: (column) => column);

  GeneratedColumn<String> get serverId =>
      $composableBuilder(column: $table.serverId, builder: (column) => column);

  GeneratedColumn<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get volunteerId => $composableBuilder(
    column: $table.volunteerId,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get startedAt =>
      $composableBuilder(column: $table.startedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get completedAt => $composableBuilder(
    column: $table.completedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get outcome =>
      $composableBuilder(column: $table.outcome, builder: (column) => column);

  GeneratedColumn<String> get formVersion => $composableBuilder(
    column: $table.formVersion,
    builder: (column) => column,
  );

  GeneratedColumn<String> get notes =>
      $composableBuilder(column: $table.notes, builder: (column) => column);

  GeneratedColumn<String> get correctsVisitId => $composableBuilder(
    column: $table.correctsVisitId,
    builder: (column) => column,
  );

  GeneratedColumnWithTypeConverter<List<String>, String> get memberIdsMet =>
      $composableBuilder(
        column: $table.memberIdsMet,
        builder: (column) => column,
      );
}

class $$VisitsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $VisitsTable,
          VisitRow,
          $$VisitsTableFilterComposer,
          $$VisitsTableOrderingComposer,
          $$VisitsTableAnnotationComposer,
          $$VisitsTableCreateCompanionBuilder,
          $$VisitsTableUpdateCompanionBuilder,
          (VisitRow, BaseReferences<_$AppDatabase, $VisitsTable, VisitRow>),
          VisitRow,
          PrefetchHooks Function()
        > {
  $$VisitsTableTableManager(_$AppDatabase db, $VisitsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$VisitsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$VisitsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$VisitsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> clientId = const Value.absent(),
                Value<String?> serverId = const Value.absent(),
                Value<String> householdId = const Value.absent(),
                Value<String> volunteerId = const Value.absent(),
                Value<DateTime> startedAt = const Value.absent(),
                Value<DateTime?> completedAt = const Value.absent(),
                Value<String> outcome = const Value.absent(),
                Value<String> formVersion = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<String?> correctsVisitId = const Value.absent(),
                Value<List<String>> memberIdsMet = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => VisitsCompanion(
                clientId: clientId,
                serverId: serverId,
                householdId: householdId,
                volunteerId: volunteerId,
                startedAt: startedAt,
                completedAt: completedAt,
                outcome: outcome,
                formVersion: formVersion,
                notes: notes,
                correctsVisitId: correctsVisitId,
                memberIdsMet: memberIdsMet,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientId,
                Value<String?> serverId = const Value.absent(),
                required String householdId,
                required String volunteerId,
                required DateTime startedAt,
                Value<DateTime?> completedAt = const Value.absent(),
                required String outcome,
                required String formVersion,
                Value<String?> notes = const Value.absent(),
                Value<String?> correctsVisitId = const Value.absent(),
                required List<String> memberIdsMet,
                Value<int> rowid = const Value.absent(),
              }) => VisitsCompanion.insert(
                clientId: clientId,
                serverId: serverId,
                householdId: householdId,
                volunteerId: volunteerId,
                startedAt: startedAt,
                completedAt: completedAt,
                outcome: outcome,
                formVersion: formVersion,
                notes: notes,
                correctsVisitId: correctsVisitId,
                memberIdsMet: memberIdsMet,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$VisitsTable, VisitRow>(table),
                  BaseReferences<_$AppDatabase, $VisitsTable, VisitRow>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$VisitsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $VisitsTable,
      VisitRow,
      $$VisitsTableFilterComposer,
      $$VisitsTableOrderingComposer,
      $$VisitsTableAnnotationComposer,
      $$VisitsTableCreateCompanionBuilder,
      $$VisitsTableUpdateCompanionBuilder,
      (VisitRow, BaseReferences<_$AppDatabase, $VisitsTable, VisitRow>),
      VisitRow,
      PrefetchHooks Function()
    >;
typedef $$SyncMetaTableCreateCompanionBuilder = SyncMetaCompanion Function({
  required String key,
  required String value,
  Value<int> rowid,
});
typedef $$SyncMetaTableUpdateCompanionBuilder = SyncMetaCompanion Function({
  Value<String> key,
  Value<String> value,
  Value<int> rowid,
});

class $$SyncMetaTableFilterComposer
    extends Composer<_$AppDatabase, $SyncMetaTable> {
  $$SyncMetaTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SyncMetaTableOrderingComposer
    extends Composer<_$AppDatabase, $SyncMetaTable> {
  $$SyncMetaTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SyncMetaTableAnnotationComposer
    extends Composer<_$AppDatabase, $SyncMetaTable> {
  $$SyncMetaTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$SyncMetaTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $SyncMetaTable,
          SyncMetaRow,
          $$SyncMetaTableFilterComposer,
          $$SyncMetaTableOrderingComposer,
          $$SyncMetaTableAnnotationComposer,
          $$SyncMetaTableCreateCompanionBuilder,
          $$SyncMetaTableUpdateCompanionBuilder,
          (
            SyncMetaRow,
            BaseReferences<_$AppDatabase, $SyncMetaTable, SyncMetaRow>,
          ),
          SyncMetaRow,
          PrefetchHooks Function()
        > {
  $$SyncMetaTableTableManager(_$AppDatabase db, $SyncMetaTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncMetaTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncMetaTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncMetaTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> key = const Value.absent(),
            Value<String> value = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) => SyncMetaCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback: ({
            required String key,
            required String value,
            Value<int> rowid = const Value.absent(),
          }) => SyncMetaCompanion.insert(key: key, value: value, rowid: rowid),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$SyncMetaTable, SyncMetaRow>(table),
                  BaseReferences<_$AppDatabase, $SyncMetaTable, SyncMetaRow>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SyncMetaTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $SyncMetaTable,
      SyncMetaRow,
      $$SyncMetaTableFilterComposer,
      $$SyncMetaTableOrderingComposer,
      $$SyncMetaTableAnnotationComposer,
      $$SyncMetaTableCreateCompanionBuilder,
      $$SyncMetaTableUpdateCompanionBuilder,
      (SyncMetaRow, BaseReferences<_$AppDatabase, $SyncMetaTable, SyncMetaRow>),
      SyncMetaRow,
      PrefetchHooks Function()
    >;
typedef $$PendingMutationsTableCreateCompanionBuilder =
    PendingMutationsCompanion Function({
      Value<int> id,
      required String key,
      required String type,
      Value<String?> householdId,
      required String payload,
      Value<String> status,
      Value<int> attempts,
      Value<DateTime?> nextAttemptAt,
      Value<String?> lastError,
      required DateTime createdAt,
    });
typedef $$PendingMutationsTableUpdateCompanionBuilder =
    PendingMutationsCompanion Function({
      Value<int> id,
      Value<String> key,
      Value<String> type,
      Value<String?> householdId,
      Value<String> payload,
      Value<String> status,
      Value<int> attempts,
      Value<DateTime?> nextAttemptAt,
      Value<String?> lastError,
      Value<DateTime> createdAt,
    });

class $$PendingMutationsTableFilterComposer
    extends Composer<_$AppDatabase, $PendingMutationsTable> {
  $$PendingMutationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$PendingMutationsTableOrderingComposer
    extends Composer<_$AppDatabase, $PendingMutationsTable> {
  $$PendingMutationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$PendingMutationsTableAnnotationComposer
    extends Composer<_$AppDatabase, $PendingMutationsTable> {
  $$PendingMutationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get householdId => $composableBuilder(
    column: $table.householdId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$PendingMutationsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $PendingMutationsTable,
          PendingMutationRow,
          $$PendingMutationsTableFilterComposer,
          $$PendingMutationsTableOrderingComposer,
          $$PendingMutationsTableAnnotationComposer,
          $$PendingMutationsTableCreateCompanionBuilder,
          $$PendingMutationsTableUpdateCompanionBuilder,
          (
            PendingMutationRow,
            BaseReferences<
              _$AppDatabase,
              $PendingMutationsTable,
              PendingMutationRow
            >,
          ),
          PendingMutationRow,
          PrefetchHooks Function()
        > {
  $$PendingMutationsTableTableManager(
    _$AppDatabase db,
    $PendingMutationsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingMutationsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingMutationsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingMutationsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String> key = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<String?> householdId = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<DateTime?> nextAttemptAt = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
              }) => PendingMutationsCompanion(
                id: id,
                key: key,
                type: type,
                householdId: householdId,
                payload: payload,
                status: status,
                attempts: attempts,
                nextAttemptAt: nextAttemptAt,
                lastError: lastError,
                createdAt: createdAt,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String key,
                required String type,
                Value<String?> householdId = const Value.absent(),
                required String payload,
                Value<String> status = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<DateTime?> nextAttemptAt = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                required DateTime createdAt,
              }) => PendingMutationsCompanion.insert(
                id: id,
                key: key,
                type: type,
                householdId: householdId,
                payload: payload,
                status: status,
                attempts: attempts,
                nextAttemptAt: nextAttemptAt,
                lastError: lastError,
                createdAt: createdAt,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$PendingMutationsTable, PendingMutationRow>(
                    table,
                  ),
                  BaseReferences<
                    _$AppDatabase,
                    $PendingMutationsTable,
                    PendingMutationRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$PendingMutationsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $PendingMutationsTable,
      PendingMutationRow,
      $$PendingMutationsTableFilterComposer,
      $$PendingMutationsTableOrderingComposer,
      $$PendingMutationsTableAnnotationComposer,
      $$PendingMutationsTableCreateCompanionBuilder,
      $$PendingMutationsTableUpdateCompanionBuilder,
      (
        PendingMutationRow,
        BaseReferences<
          _$AppDatabase,
          $PendingMutationsTable,
          PendingMutationRow
        >,
      ),
      PendingMutationRow,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$FieldDefinitionsTableTableManager get fieldDefinitions =>
      $$FieldDefinitionsTableTableManager(_db, _db.fieldDefinitions);
  $$HouseholdsTableTableManager get households =>
      $$HouseholdsTableTableManager(_db, _db.households);
  $$VotersTableTableManager get voters =>
      $$VotersTableTableManager(_db, _db.voters);
  $$FieldValuesTableTableManager get fieldValues =>
      $$FieldValuesTableTableManager(_db, _db.fieldValues);
  $$VisitsTableTableManager get visits =>
      $$VisitsTableTableManager(_db, _db.visits);
  $$SyncMetaTableTableManager get syncMeta =>
      $$SyncMetaTableTableManager(_db, _db.syncMeta);
  $$PendingMutationsTableTableManager get pendingMutations =>
      $$PendingMutationsTableTableManager(_db, _db.pendingMutations);
}
