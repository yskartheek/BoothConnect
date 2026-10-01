import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/local/local_writes.dart';
import 'package:boothconnect_mobile/data/location/location_reader.dart';
import 'package:boothconnect_mobile/data/sync/push_repository.dart';
import 'package:boothconnect_mobile/features/home/home_screen.dart'
    show boothsProvider;
import 'package:boothconnect_mobile/features/households/household_address_screen.dart';
import 'package:boothconnect_mobile/features/households/household_screen.dart';
import 'package:boothconnect_mobile/features/households/new_household_screen.dart';
import 'package:boothconnect_mobile/features/sync/sync_screen.dart'
    show displayValue;
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:boothconnect_mobile/theme/app_theme.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/fake_sync_api.dart';
import '../support/memory_secrets.dart';

// Synthetic data only: made-up addresses and coordinates.

/// Answers each call with the next of [answers]: a [LocationFix], or a
/// [LocationProblem] to fail with.
class FakeLocationReader implements LocationReader {
  FakeLocationReader(this.answers);

  final List<Object> answers;
  var calls = 0;
  var settingsOpened = 0;

  @override
  Future<LocationFix> current() async {
    calls++;
    final next = answers.removeAt(0);
    if (next is LocationProblem) throw LocationFailure(next);
    return next as LocationFix;
  }

  @override
  Future<void> openSettings() async => settingsOpened++;
}

final fix = LocationFix(
  lat: 17.38501,
  lng: 78.48667,
  accuracyM: 8,
  capturedAt: DateTime.utc(2026, 9, 26, 12, 12),
);

class _Fixed implements Random {
  @override
  double nextDouble() => 0;
  @override
  int nextInt(int max) => 0;
  @override
  bool nextBool() => false;
}

/// The volunteer, and a household of their booth from the roll with an
/// address the server sent (value `srv-address`).
Future<void> seed(AppDatabase db) async {
  await db
      .into(db.syncMeta)
      .insertOnConflictUpdate(
        SyncMetaCompanion.insert(key: 'owner', value: 'u-1'),
      );
  await db
      .into(db.syncMeta)
      .insertOnConflictUpdate(
        SyncMetaCompanion.insert(
          key: 'assignments',
          value: '[{"id":"station-1","name":"Synthetic School","code":"142"}]',
        ),
      );
  await db
      .into(db.households)
      .insert(
        HouseholdsCompanion.insert(
          id: 'h-1',
          partId: 'part-1',
          pollingStationId: 'station-1',
          displayAddress: '12/4, Gandhi Road',
          houseKey: '12/4',
          structuredAddress: const Value(
            '{"house_no":"12/4","street":"Gandhi Road"}',
          ),
          origin: 'official_import',
          status: 'active',
        ),
      );
  await db
      .into(db.fieldValues)
      .insert(
        FieldValuesCompanion.insert(
          id: 'srv-address',
          entityType: 'household',
          entityId: 'h-1',
          fieldKey: addressKey,
          value: '{"house_no":"12/4","street":"Gandhi Road"}',
          sourceType: 'official_import',
          collectedAt: DateTime.utc(2026, 1, 1),
          isCurrent: true,
        ),
      );
}

Future<List<PendingMutationRow>> queued(AppDatabase db) => (db.select(
  db.pendingMutations,
)..orderBy([(t) => OrderingTerm(expression: t.id)])).get();

Map<String, dynamic> payloadOf(PendingMutationRow m) =>
    jsonDecode(m.payload) as Map<String, dynamic>;

final at = DateTime.utc(2026, 9, 30, 10);

HouseholdLocation reading() => HouseholdLocation(
  lat: fix.lat,
  lng: fix.lng,
  accuracyM: fix.accuracyM,
  capturedAt: fix.capturedAt,
);

void main() {
  group('household writes', () {
    late Directory dir;
    late LocalStore store;
    late AppDatabase db;

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_address_test');
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(MemorySecrets()),
        inBackground: false,
      );
      db = await store.open();
      await seed(db);
    });
    tearDown(() async {
      await store.wipe();
      dir.deleteSync(recursive: true);
    });

    Future<FieldValueRow> current(String key) =>
        (db.select(db.fieldValues)..where(
              (t) =>
                  t.entityId.equals('h-1') &
                  t.fieldKey.equals(key) &
                  t.isCurrent.equals(true),
            ))
            .getSingle();

    test('a new address: on the phone at once, queued with its base', () async {
      await db.updateHousehold(
        householdId: 'h-1',
        address: {
          'house_no': ' 12/4 ',
          'street': 'Gandhi Road',
          'area': 'Nehru Nagar',
          'pin_code': '500038',
          'landmark': '',
        },
        at: at,
      );
      final h = await (db.select(
        db.households,
      )..where((t) => t.id.equals('h-1'))).getSingle();
      expect(h.displayAddress, '12/4, Gandhi Road, Nehru Nagar, 500038');
      expect(jsonDecode(h.structuredAddress!), {
        'house_no': '12/4',
        'street': 'Gandhi Road',
        'area': 'Nehru Nagar',
        'pin_code': '500038',
      });

      final value = await current(addressKey);
      expect(value.supersedesId, 'srv-address');
      expect(value.entityType, 'household');
      expect(value.collectedById, 'u-1');

      final m = (await queued(db)).single;
      expect(m.type, 'household.update');
      expect(m.householdId, 'h-1');
      final payload = payloadOf(m);
      expect(payload['id'], 'h-1');
      expect(payload['addressBaseVersion'], 'srv-address');
      expect(payload['address'], {
        'house_no': '12/4',
        'street': 'Gandhi Road',
        'area': 'Nehru Nagar',
        'pin_code': '500038',
      });
      expect(payload.containsKey('location'), isFalse);
      expect(payload.containsKey('locationBaseVersion'), isFalse);
      expect(payload['_fieldValueIds'], {addressKey: value.id});

      final summary = (await db.watchHouseholdSummaries().first).single;
      expect(summary.sync, HouseholdSync.onPhone);
    });

    test('a location goes with the household’s consent', () async {
      await db.updateHousehold(householdId: 'h-1', location: reading(), at: at);
      final h = await (db.select(
        db.households,
      )..where((t) => t.id.equals('h-1'))).getSingle();
      expect((h.latitude, h.longitude, h.accuracyM), (17.38501, 78.48667, 8));
      expect(h.locationCapturedAt!.isAtSameMomentAs(fix.capturedAt), isTrue);
      // The address is untouched.
      expect(h.displayAddress, '12/4, Gandhi Road');

      final payload = payloadOf((await queued(db)).single);
      expect(payload['location'], {
        'lat': 17.38501,
        'lng': 78.48667,
        'accuracyM': 8.0,
        'capturedAt': '2026-09-26T12:12:00.000Z',
        'consent': {'noticeVersion': '2026.1', 'method': 'in_person_verbal'},
      });
      expect(payload['locationBaseVersion'], isNull);
      expect(payload.containsKey('locationBaseVersion'), isTrue);
      expect(payload.containsKey('address'), isFalse);

      // The phone's copy is the reading, without the consent.
      final value = await current(locationKey);
      expect(jsonDecode(value.value), {
        'lat': 17.38501,
        'lng': 78.48667,
        'accuracyM': 8.0,
        'capturedAt': '2026-09-26T12:12:00.000Z',
      });
      expect(value.collectedAt.isAtSameMomentAs(fix.capturedAt), isTrue);
      // The address value stays current.
      expect((await current(addressKey)).id, 'srv-address');
    });

    test('nothing to save: nothing queued', () async {
      await db.updateHousehold(householdId: 'h-1', at: at);
      expect(await queued(db), isEmpty);
    });

    test(
      'adding a household: on the phone at once, queued with its id',
      () async {
        final id = await db.addHousehold(
          pollingStationId: 'station-1',
          address: {
            'house_no': '7',
            'street': ' Lake View Road ',
            'area': '',
            'pin_code': '500038',
            'landmark': 'Near water tank',
          },
          location: reading(),
          at: at,
        );
        final h = await (db.select(
          db.households,
        )..where((t) => t.id.equals(id))).getSingle();
        expect(h.partId, 'part-1');
        expect(h.pollingStationId, 'station-1');
        expect(h.houseKey, '7');
        expect(h.displayAddress, '7, Lake View Road, 500038');
        expect(h.origin, 'volunteer_added');
        expect(h.status, 'active');
        expect(h.latitude, 17.38501);

        final m = (await queued(db)).single;
        expect(m.type, 'household.create');
        expect(m.householdId, id);
        final payload = payloadOf(m);
        expect(payload['id'], id);
        expect(payload['pollingStationId'], 'station-1');
        expect(payload['address'], {
          'house_no': '7',
          'street': 'Lake View Road',
          'pin_code': '500038',
          'landmark': 'Near water tank',
        });
        expect((payload['location'] as Map<String, dynamic>)['consent'], {
          'noticeVersion': '2026.1',
          'method': 'in_person_verbal',
        });

        // In the households list.
        final summaries = await db.watchHouseholdSummaries().first;
        expect(summaries.map((s) => s.id), contains(id));
      },
    );

    test('without a house number, a key that can’t clash', () async {
      final id = await db.addHousehold(
        pollingStationId: 'station-1',
        address: {'street': 'Lake View Road'},
        at: at,
      );
      final h = await (db.select(
        db.households,
      )..where((t) => t.id.equals(id))).getSingle();
      expect(h.houseKey, '~$id');
      expect(
        payloadOf((await queued(db)).single).containsKey('location'),
        isFalse,
      );
    });

    test('a house number already in the part is refused', () async {
      await expectLater(
        db.addHousehold(
          pollingStationId: 'station-1',
          address: {'house_no': '12/4', 'street': 'Other Street'},
          at: at,
        ),
        throwsA(isA<HouseNumberTaken>()),
      );
      expect(await queued(db), isEmpty);
      expect(await db.select(db.households).get(), hasLength(1));
    });

    test('editing a household not sent yet updates its creation', () async {
      final id = await db.addHousehold(
        pollingStationId: 'station-1',
        address: {'house_no': '7', 'street': 'Lake View Road'},
        at: at,
      );
      await db.updateHousehold(
        householdId: id,
        address: {'house_no': '7A', 'street': 'Lake View Road'},
        location: reading(),
        at: at,
      );
      final m = (await queued(db)).single;
      expect(m.type, 'household.create');
      final payload = payloadOf(m);
      expect(payload['address'], {
        'house_no': '7A',
        'street': 'Lake View Road',
      });
      expect(payload['location'], isNotNull);
      final h = await (db.select(
        db.households,
      )..where((t) => t.id.equals(id))).getSingle();
      expect(h.displayAddress, '7A, Lake View Road');
    });

    test(
      'once its creation was sent, an edit is a change of its own',
      () async {
        final id = await db.addHousehold(
          pollingStationId: 'station-1',
          address: {'house_no': '7'},
          at: at,
        );
        await db.customUpdate('UPDATE pending_mutation SET attempts = 1');
        await db.updateHousehold(
          householdId: id,
          address: {'house_no': '7A'},
          at: at,
        );
        final all = await queued(db);
        expect(all.map((m) => m.type), [
          'household.create',
          'household.update',
        ]);
        expect(payloadOf(all.first)['address'], {'house_no': '7'});
        expect(payloadOf(all.last)['addressBaseVersion'], isNull);
      },
    );

    group('uploading', () {
      late FakeSyncApi api;
      final now = DateTime.utc(2026, 9, 30, 12);
      PushRepository repository() => PushRepository(db, api, random: _Fixed());

      setUp(() => api = FakeSyncApi());

      Map<String, dynamic> updated(
        Map<String, Object?> m, {
        String status = 'applied',
      }) => {
        'status': status,
        'result': {
          'household': <String, Object>{},
          'results': {
            'address': {
              'status': status,
              'fieldValueId': 'srv-a-${m['key']}',
              if (status == 'conflict') 'conflictWithId': 'srv-theirs',
            },
            'location': {
              'status': 'applied',
              'fieldValueId': 'srv-l-${m['key']}',
            },
          },
        },
      };

      test('the phone’s values take the server’s ids', () async {
        await db.updateHousehold(
          householdId: 'h-1',
          address: {'house_no': '12/4', 'street': 'New Road'},
          location: reading(),
          at: at,
        );
        final key = (await queued(db)).single.key;
        api.answer = updated;
        await repository().pushDue(now: () => now);

        final sent = api.pushed.single.single;
        expect(sent['type'], 'household.update');
        final payload = sent['payload']! as Map<String, dynamic>;
        expect(payload.keys, isNot(contains('_fieldValueIds')));
        expect(payload['addressBaseVersion'], 'srv-address');

        expect(await queued(db), isEmpty);
        expect((await current(addressKey)).id, 'srv-a-$key');
        expect((await current(locationKey)).id, 'srv-l-$key');
      });

      test('an edit based on one in the same batch waits for its id', () async {
        await db.updateHousehold(
          householdId: 'h-1',
          address: {'house_no': '12/4', 'street': 'New Road'},
          at: at,
        );
        await db.updateHousehold(
          householdId: 'h-1',
          address: {'house_no': '12/4', 'street': 'Newer Road'},
          at: at,
        );
        final first = (await queued(db)).first.key;
        api.answer = updated;
        await repository().pushDue(now: () => now);

        expect(api.pushed, hasLength(2));
        expect(api.pushed.first, hasLength(1));
        final second =
            api.pushed.last.single['payload']! as Map<String, dynamic>;
        expect(second['addressBaseVersion'], 'srv-a-$first');
      });

      test('a conflict: kept for the volunteer to choose', () async {
        await db.updateHousehold(
          householdId: 'h-1',
          address: {'house_no': '12/4', 'street': 'New Road'},
          at: at,
        );
        final key = (await queued(db)).single.key;
        api.answer = (m) => updated(m, status: 'conflict');
        final result = await repository().pushDue(now: () => now);
        expect(result.conflicts, 1);
        final value = await (db.select(
          db.fieldValues,
        )..where((t) => t.id.equals('srv-a-$key'))).getSingle();
        expect(value.conflictWithId, 'srv-theirs');
        expect((await queued(db)).single.status, 'conflict');

        // Choosing a value clears the household change too.
        await db
            .into(db.fieldValues)
            .insert(
              FieldValuesCompanion.insert(
                id: 'srv-theirs',
                entityType: 'household',
                entityId: 'h-1',
                fieldKey: addressKey,
                value: '{"house_no":"12/4","street":"Their Road"}',
                sourceType: 'volunteer_collected',
                collectedAt: at,
                isCurrent: true,
              ),
            );
        final conflict = (await db.watchOpenConflicts().first).single;
        await db.resolveConflict(conflict, 'srv-theirs');
        final left = await queued(db);
        expect(left.map((m) => m.type), ['conflict.resolve']);
      });

      test('an added household is sent as household.create', () async {
        final id = await db.addHousehold(
          pollingStationId: 'station-1',
          address: {'house_no': '7'},
          at: at,
        );
        await repository().pushDue(now: () => now);
        final sent = api.pushed.single.single;
        expect(sent['type'], 'household.create');
        expect((sent['payload']! as Map<String, dynamic>)['id'], id);
        expect(await queued(db), isEmpty);
      });
    });
  });

  test('a location shows as its coordinates', () {
    expect(
      displayValue({
        'lat': 17.385012,
        'lng': 78.486671,
        'accuracyM': 8,
        'capturedAt': '2026-09-26T12:12:00.000Z',
      }),
      '17.38501, 78.48667',
    );
    expect(
      displayValue({'house_no': '12/4', 'street': 'Gandhi Road'}),
      '12/4, Gandhi Road',
    );
  });

  group('the address screen', () {
    HouseholdRow household({bool located = false}) => HouseholdRow(
      id: 'h-1',
      partId: 'part-1',
      pollingStationId: 'station-1',
      displayAddress: '12/4, Gandhi Road',
      houseKey: '12/4',
      structuredAddress:
          '{"house_no":"12/4","street":"Gandhi Road","area":"Nehru Nagar",'
          '"pin_code":"500038","landmark":"Near water tank"}',
      latitude: located ? 17.38 : null,
      longitude: located ? 78.48 : null,
      accuracyM: located ? 12 : null,
      locationCapturedAt: located ? DateTime.utc(2026, 9, 20, 4, 30) : null,
      origin: 'official_import',
      status: 'active',
    );

    Future<FakeLocationReader> show(
      WidgetTester tester, {
      HouseholdRow? row,
      List<Object> answers = const [],
      Set<String> disabled = const {},
      bool add = false,
      List<String> stations = const ['station-1'],
      TargetPlatform platform = TargetPlatform.android,
      Locale locale = const Locale('en'),
      double textScale = 1,
      bool tall = true,
    }) async {
      if (tall) {
        tester.view.physicalSize = const Size(800, 2400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
      }
      final reader = FakeLocationReader([...answers]);
      await tester.pumpWidget(
        ProviderScope(
          key: UniqueKey(),
          overrides: <Override>[
            householdProvider.overrideWith(
              (ref, id) => Stream.value(row ?? household()),
            ),
            disabledFieldsProvider.overrideWith(
              (ref) => Stream.value(disabled),
            ),
            pollingStationIdsProvider.overrideWith(
              (ref) => Stream.value(stations),
            ),
            boothsProvider.overrideWith(
              (ref) => Stream.value(const [
                BoothAssignment(
                  id: 'station-1',
                  name: 'Synthetic School',
                  code: '142',
                ),
                BoothAssignment(
                  id: 'station-2',
                  name: 'Synthetic Hall',
                  code: '143',
                ),
              ]),
            ),
            locationReaderProvider.overrideWithValue(reader),
          ],
          child: MaterialApp(
            theme: AppTheme.light().copyWith(platform: platform),
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            builder: (context, child) => MediaQuery.withClampedTextScaling(
              minScaleFactor: textScale,
              maxScaleFactor: textScale,
              child: child!,
            ),
            home: add
                ? const NewHouseholdScreen()
                : const HouseholdAddressScreen(householdId: 'h-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return reader;
    }

    String fieldText(WidgetTester tester, String label) => tester
        .widget<TextField>(find.widgetWithText(TextField, label))
        .controller!
        .text;

    final useLocation = find.widgetWithText(
      OutlinedButton,
      'Use my current location',
    );
    final agree = find.text('The household agrees to store its location');

    bool enabled(WidgetTester tester, Finder button) =>
        tester.widget<ButtonStyleButton>(button).onPressed != null;

    testWidgets('the address in its parts, from the phone', (tester) async {
      await show(tester);
      expect(find.widgetWithText(AppBar, 'Address'), findsOneWidget);
      expect(fieldText(tester, 'House no.'), '12/4');
      expect(fieldText(tester, 'Street'), 'Gandhi Road');
      expect(fieldText(tester, 'Area / locality'), 'Nehru Nagar');
      expect(fieldText(tester, 'PIN code'), '500038');
      expect(fieldText(tester, 'Landmark'), 'Near water tank');
      expect(find.text('Location'), findsOneWidget);
      expect(find.text('No location saved yet.'), findsOneWidget);
      expect(
        find.text(
          'Location is taken once, when you tap the button. '
          'The app never tracks you.',
        ),
        findsOneWidget,
      );
      // Android: a check; iOS: a text button.
      expect(find.byTooltip('Save'), findsOneWidget);
    });

    testWidgets('on iOS, Save is a text button', (tester) async {
      await show(tester, platform: TargetPlatform.iOS);
      expect(find.widgetWithText(TextButton, 'Save'), findsOneWidget);
    });

    testWidgets('a saved location: preview, accuracy and when', (tester) async {
      await show(tester, row: household(located: true));
      expect(find.text('Saved'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Location saved, accurate to 12 m'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Accurate to about 12 m · captured Sep 20'),
        findsOneWidget,
      );
    });

    testWidgets('PIN code: 6 digits', (tester) async {
      await show(tester);
      for (final bad in ['50003', '5000381', '50O038']) {
        await tester.enterText(find.widgetWithText(TextField, 'PIN code'), bad);
        await tester.tap(find.byTooltip('Save'));
        await tester.pumpAndSettle();
        expect(find.text('Enter a 6-digit PIN code.'), findsOneWidget);
      }
      await tester.enterText(
        find.widgetWithText(TextField, 'PIN code'),
        '500039',
      );
      await tester.pumpAndSettle();
      // An empty PIN code is fine too.
      final state = tester.state<FormState>(find.byType(Form));
      expect(state.validate(), isTrue);
      await tester.enterText(find.widgetWithText(TextField, 'PIN code'), '');
      expect(state.validate(), isTrue);
    });

    testWidgets('an empty address is refused', (tester) async {
      await show(tester, add: true);
      await tester.tap(find.byTooltip('Save'));
      await tester.pumpAndSettle();
      expect(
        find.text('Enter at least one part of the address.'),
        findsOneWidget,
      );
    });

    testWidgets('the location button waits for the household’s consent', (
      tester,
    ) async {
      final reader = await show(tester, answers: [fix]);
      expect(enabled(tester, useLocation), isFalse);
      await tester.tap(agree);
      await tester.pumpAndSettle();
      expect(enabled(tester, useLocation), isTrue);

      await tester.tap(useLocation);
      await tester.pumpAndSettle();
      expect(reader.calls, 1);
      expect(find.text('Not saved yet'), findsOneWidget);
      expect(
        find.textContaining('Accurate to about 8 m · captured Sep 26'),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel('Location saved, accurate to 8 m'),
        findsOneWidget,
      );

      // Unticked: the reading goes too.
      await tester.tap(agree);
      await tester.pumpAndSettle();
      expect(find.text('Not saved yet'), findsNothing);
      expect(find.text('No location saved yet.'), findsOneWidget);
    });

    testWidgets('permission refused: a clear message, and nothing taken', (
      tester,
    ) async {
      final reader = await show(tester, answers: [LocationProblem.denied, fix]);
      await tester.tap(agree);
      await tester.pumpAndSettle();
      await tester.tap(useLocation);
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Location permission was refused. Tap the button again to allow '
          'it, or save without a location.',
        ),
        findsOneWidget,
      );
      expect(find.text('Not saved yet'), findsNothing);
      expect(find.text('Open settings'), findsNothing);

      // Asked again: the message goes.
      await tester.tap(useLocation);
      await tester.pumpAndSettle();
      expect(reader.calls, 2);
      expect(find.textContaining('permission was refused'), findsNothing);
      expect(find.text('Not saved yet'), findsOneWidget);
    });

    testWidgets('refused for good: the way to the settings', (tester) async {
      final reader = await show(
        tester,
        answers: [LocationProblem.deniedForever],
      );
      await tester.tap(agree);
      await tester.pumpAndSettle();
      await tester.tap(useLocation);
      await tester.pumpAndSettle();
      expect(
        find.text(
          "Location is blocked for this app. Allow it in the phone's "
          'settings to use this button.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Open settings'));
      await tester.pumpAndSettle();
      expect(reader.settingsOpened, 1);
    });

    testWidgets('location off, or no fix', (tester) async {
      await show(
        tester,
        answers: [LocationProblem.off, LocationProblem.unavailable],
      );
      await tester.tap(agree);
      await tester.pumpAndSettle();
      await tester.tap(useLocation);
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Location is turned off on this phone. Turn it on and try again.',
        ),
        findsOneWidget,
      );
      await tester.tap(useLocation);
      await tester.pumpAndSettle();
      expect(
        find.text(
          "Couldn't get a location here. Try again, or save without one.",
        ),
        findsOneWidget,
      );
    });

    testWidgets('location turned off by the admin: no location card', (
      tester,
    ) async {
      await show(tester, disabled: {locationKey});
      expect(find.text('Location'), findsNothing);
      expect(useLocation, findsNothing);
      expect(find.widgetWithText(TextField, 'House no.'), findsOneWidget);
    });

    testWidgets('a new household: empty, in the volunteer’s booth', (
      tester,
    ) async {
      await show(tester, add: true);
      expect(find.widgetWithText(AppBar, 'New household'), findsOneWidget);
      expect(fieldText(tester, 'House no.'), '');
      // One booth: nothing to choose.
      expect(find.text('Booth'), findsNothing);
    });

    testWidgets('several booths: the volunteer chooses', (tester) async {
      await show(tester, add: true, stations: ['station-1', 'station-2']);
      expect(find.text('Booth'), findsOneWidget);
      expect(find.text('Synthetic School, booth 142'), findsOneWidget);
    });

    testWidgets('no booth on the phone yet: says why', (tester) async {
      await show(tester, add: true, stations: const []);
      expect(find.textContaining('have to be downloaded'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('a small phone at large text: nothing overflows', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await show(
        tester,
        row: household(located: true),
        textScale: 2,
        tall: false,
        answers: [LocationProblem.deniedForever],
      );
      await tester.ensureVisible(agree);
      await tester.pumpAndSettle();
      await tester.tap(agree);
      await tester.pumpAndSettle();
      await tester.ensureVisible(useLocation);
      await tester.pumpAndSettle();
      await tester.tap(useLocation);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Open settings'));
      await tester.pumpAndSettle();
      expect(find.text('Open settings').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('in Telugu', (tester) async {
      await show(tester, locale: const Locale('te'));
      expect(find.text('ఇంటి నం.'), findsOneWidget);
      expect(find.text('పిన్ కోడ్'), findsOneWidget);
      expect(find.text('నా ప్రస్తుత స్థానం ఉపయోగించు'), findsOneWidget);
    });
  });

  group('in the app, offline', () {
    Future<(ProviderContainer, AppDatabase)> open(
      WidgetTester tester,
      String path, {
      List<Object> answers = const [],
    }) async {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final container = await startApp(
        tester,
        api: FakeAuthApi(session: true),
        syncApi: FakeSyncApi(List.filled(20, offline, growable: true)),
        connectivity: Stream.value([ConnectivityResult.none]),
        overrides: [
          locationReaderProvider.overrideWithValue(
            FakeLocationReader([...answers]),
          ),
        ],
      );
      final db = await settle(
        tester,
        container.read(appDatabaseProvider.future),
      );
      await settle(tester, seed(db));
      await go(tester, container, path);
      await waitFor(
        tester,
        () => find.widgetWithText(TextField, 'Street').evaluate().isNotEmpty,
      );
      return (container, db);
    }

    testWidgets('saving an address and a location queues household.update', (
      tester,
    ) async {
      final (_, db) = await open(
        tester,
        '/household/h-1/address',
        answers: [fix],
      );
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'Street'))
            .controller!
            .text,
        'Gandhi Road',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Area / locality'),
        'Nehru Nagar',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'PIN code'),
        '500038',
      );
      await tester.tap(find.text('The household agrees to store its location'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use my current location'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      expect(
        find.text("Saved. It uploads when you're online."),
        findsOneWidget,
      );
      final m = (await settle(tester, queued(db))).single;
      expect(m.type, 'household.update');
      final payload = payloadOf(m);
      expect(payload['address'], {
        'house_no': '12/4',
        'street': 'Gandhi Road',
        'area': 'Nehru Nagar',
        'pin_code': '500038',
      });
      expect(payload['addressBaseVersion'], 'srv-address');
      expect((payload['location'] as Map<String, dynamic>)['lat'], 17.38501);

      // The household shows it.
      await waitFor(
        tester,
        () => find
            .text('12/4, Gandhi Road, Nehru Nagar, 500038')
            .evaluate()
            .isNotEmpty,
      );
      expect(find.text('Nehru Nagar · 500038'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Location saved, accurate to 8 m'),
        findsOneWidget,
      );
      expect(find.text('On phone'), findsOneWidget);
    });

    testWidgets('only the address changed: only the address is sent', (
      tester,
    ) async {
      final (_, db) = await open(tester, '/household/h-1/address');
      await tester.enterText(
        find.widgetWithText(TextField, 'Landmark'),
        'Near water tank',
      );
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      final payload = payloadOf((await settle(tester, queued(db))).single);
      expect(payload['address'], {
        'house_no': '12/4',
        'street': 'Gandhi Road',
        'landmark': 'Near water tank',
      });
      expect(payload.containsKey('location'), isFalse);
    });

    testWidgets('only a location taken: the address isn’t sent', (
      tester,
    ) async {
      final (_, db) = await open(
        tester,
        '/household/h-1/address',
        answers: [fix],
      );
      await tester.tap(find.text('The household agrees to store its location'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use my current location'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      final payload = payloadOf((await settle(tester, queued(db))).single);
      expect(payload.containsKey('address'), isFalse);
      expect(payload.containsKey('addressBaseVersion'), isFalse);
      expect((payload['location'] as Map<String, dynamic>)['lng'], 78.48667);
    });

    testWidgets('nothing changed: nothing queued', (tester) async {
      final (_, db) = await open(tester, '/household/h-1/address');
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      expect(await settle(tester, queued(db)), isEmpty);
    });

    testWidgets('a bad PIN code is never saved', (tester) async {
      final (_, db) = await open(tester, '/household/h-1/address');
      await tester.enterText(
        find.widgetWithText(TextField, 'PIN code'),
        '1234',
      );
      await tester.tap(find.byTooltip('Save'));
      await tester.pumpAndSettle();
      expect(find.text('Enter a 6-digit PIN code.'), findsOneWidget);
      expect(find.byType(HouseholdAddressScreen), findsOneWidget);
      expect(await settle(tester, queued(db)), isEmpty);
    });

    testWidgets('Add household: queued as household.create, then opened', (
      tester,
    ) async {
      final (container, db) = await open(tester, '/households/new');
      await tester.enterText(
        find.widgetWithText(TextField, 'House no.'),
        '12/4',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Street'),
        'Lake View Road',
      );
      await tester.tap(find.byTooltip('Save'));
      await tester.pumpAndSettle();
      // Already on the list.
      await waitFor(
        tester,
        () => find
            .text('A household with this house number is already on the list.')
            .evaluate()
            .isNotEmpty,
      );
      expect(
        find.text('A household with this house number is already on the list.'),
        findsOneWidget,
      );
      expect(await settle(tester, queued(db)), isEmpty);

      await tester.enterText(find.widgetWithText(TextField, 'House no.'), '7');
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      expect(
        find.text("Household added. It uploads when you're online."),
        findsOneWidget,
      );
      final m = (await settle(tester, queued(db))).single;
      expect(m.type, 'household.create');
      final payload = payloadOf(m);
      expect(payload['pollingStationId'], 'station-1');
      expect(payload['address'], {'house_no': '7', 'street': 'Lake View Road'});
      expect(location(container), '/household/${payload['id']}');
      await waitFor(
        tester,
        () => find.text('7, Lake View Road').evaluate().isNotEmpty,
      );
      expect(find.text('7, Lake View Road'), findsOneWidget);
      expect(find.text('On phone'), findsOneWidget);
    });
  });
}
