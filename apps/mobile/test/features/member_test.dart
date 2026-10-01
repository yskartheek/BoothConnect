import 'dart:convert';
import 'dart:io';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/data/local/local_writes.dart';
import 'package:boothconnect_mobile/data/sync/push_repository.dart';
import 'package:boothconnect_mobile/features/home/home_screen.dart'
    show boothsProvider;
import 'package:boothconnect_mobile/features/households/household_screen.dart';
import 'package:boothconnect_mobile/features/members/member_screen.dart';
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

// Synthetic data only.

FieldDefinitionsCompanion definition(
  String key, {
  bool enabled = true,
  String? options,
  bool restricted = false,
}) => FieldDefinitionsCompanion.insert(
  id: 'fd-$key',
  key: key,
  labelKey: 'field.$key',
  appliesTo: 'voter',
  type: 'text',
  options: Value(options),
  isRestricted: restricted,
  requiresConsent: restricted,
  enabled: enabled,
  purpose: 'Synthetic',
);

/// The volunteer and their booth, a household with one member from the
/// roll, and the member fields (caste behind consent).
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
          value: '[{"name":"Synthetic School","code":"142"}]',
        ),
      );
  await db
      .into(db.households)
      .insert(
        HouseholdsCompanion.insert(
          id: 'h-1',
          partId: 'part-1',
          pollingStationId: 'station-1',
          displayAddress: '12/4 Gandhi Road',
          houseKey: '12/4',
          origin: 'official_import',
          status: 'active',
        ),
      );
  await db
      .into(db.voters)
      .insert(
        VotersCompanion.insert(
          id: 'v-1',
          householdId: 'h-1',
          partId: 'part-1',
          pollingStationId: 'station-1',
          origin: 'official_import',
          recordStatus: 'active',
          serialNo: const Value(1),
          epicNumber: const Value('SYN0000001'),
          official: '{"name":"Synthetic Arjun","age":49,"gender":"male"}',
          previousVoterIds: const [],
        ),
      );
  for (final key in [
    'name',
    'age',
    'gender',
    'mobile_number',
    'occupation',
    'additional_info',
  ]) {
    await db.into(db.fieldDefinitions).insert(definition(key));
  }
  await db
      .into(db.fieldDefinitions)
      .insert(definition(casteKey, restricted: true));
}

Future<List<PendingMutationRow>> queued(AppDatabase db) => (db.select(
  db.pendingMutations,
)..orderBy([(t) => OrderingTerm(expression: t.id)])).get();

Map<String, dynamic> payloadOf(PendingMutationRow m) =>
    jsonDecode(m.payload) as Map<String, dynamic>;

void main() {
  group('member writes and reads', () {
    late Directory dir;
    late LocalStore store;
    late AppDatabase db;

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_member_test');
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

    test(
      'adding a member: on the phone at once, queued as member.create',
      () async {
        final id = await db.addMember(
          householdId: 'h-1',
          name: 'Synthetic Meera',
          age: 21,
          gender: 'female',
          fields: {'occupation': 'Student', 'mobile_number': '+919999900555'},
          at: DateTime.utc(2026, 10, 1, 10),
        );
        final voter = await (db.select(
          db.voters,
        )..where((t) => t.id.equals(id))).getSingle();
        expect(voter.origin, 'volunteer_added');
        expect(voter.householdId, 'h-1');
        expect((voter.partId, voter.pollingStationId), ('part-1', 'station-1'));
        expect(voter.serialNo, isNull);

        final card = (await db.watchMemberCards('h-1').first).last;
        expect(
          (card.id, card.name, card.age, card.gender, card.occupation),
          (id, 'Synthetic Meera', 21, 'female', 'Student'),
        );

        final m = (await queued(db)).single;
        expect(m.type, 'member.create');
        expect(m.householdId, 'h-1');
        final p = payloadOf(m);
        expect(p['householdId'], 'h-1');
        expect(p['id'], id);
        expect(
          (p['name'], p['age'], p['gender']),
          ('Synthetic Meera', 21, 'female'),
        );
        expect(p['fields'], [
          {'fieldKey': 'occupation', 'value': 'Student'},
          {'fieldKey': 'mobile_number', 'value': '+919999900555'},
        ]);
        final localIds = p['_fieldValueIds'] as Map<String, dynamic>;
        expect(
          localIds.keys,
          unorderedEquals([
            'name',
            'age',
            'gender',
            'occupation',
            'mobile_number',
          ]),
        );
        final values = await db.select(db.fieldValues).get();
        expect(values.map((v) => v.id), unorderedEquals(localIds.values));
        expect(values.map((v) => v.collectedById), everyElement('u-1'));
      },
    );

    test('a name alone is enough', () async {
      final id = await db.addMember(
        householdId: 'h-1',
        name: 'Synthetic Ravi',
        at: DateTime.utc(2026, 10, 1),
      );
      final p = payloadOf((await queued(db)).single);
      expect(p.keys, isNot(contains('age')));
      expect(p.keys, isNot(contains('gender')));
      expect(p['fields'], isEmpty);
      expect(
        (await db.watchMemberDetail(id).first)!.value('name'),
        'Synthetic Ravi',
      );
    });

    test(
      'caste: the consent first, the value never kept on the phone',
      () async {
        final at = DateTime.utc(2026, 10, 1, 10);
        final consentId = await db.captureConsent(
          voterId: 'v-1',
          householdId: 'h-1',
          purpose: casteKey,
          at: at,
        );
        await db.queueRestrictedField(
          voterId: 'v-1',
          householdId: 'h-1',
          fieldKey: casteKey,
          value: 'Synthetic community',
          consentId: consentId,
          at: at,
        );
        final all = await queued(db);
        expect(all.map((m) => m.type), ['consent.capture', 'field.change']);
        expect(payloadOf(all.first), {
          'id': consentId,
          'voterId': 'v-1',
          'purpose': casteKey,
          'noticeVersion': consentNoticeVersion,
          'method': 'in_person_verbal',
          'capturedAt': '2026-10-01T10:00:00.000Z',
        });
        expect(payloadOf(all.last), {
          'entityType': 'voter',
          'entityId': 'v-1',
          'fieldKey': casteKey,
          'value': 'Synthetic community',
          'baseVersion': null,
          'consentId': consentId,
          'collectedAt': '2026-10-01T10:00:00.000Z',
        });
        expect(all.map((m) => m.householdId), everyElement('h-1'));
        // Nothing about it on the phone but the queued change.
        expect(await db.select(db.fieldValues).get(), isEmpty);
        final detail = await db.watchMemberDetail('v-1').first;
        expect(detail!.waitingRestricted, {casteKey});
        expect(detail.value(casteKey), isNull);
      },
    );

    test(
      'a member’s details: the latest current value, else the roll',
      () async {
        final detail = await db.watchMemberDetail('v-1').first;
        expect(detail!.voter.epicNumber, 'SYN0000001');
        expect(
          (detail.value('name'), detail.value('age')),
          ('Synthetic Arjun', 49),
        );
        expect(detail.waitingRestricted, isEmpty);

        final seen = <MemberDetail?>[];
        final sub = db.watchMemberDetail('v-1').listen(seen.add);
        addTearDown(sub.cancel);
        await pumpEventQueue();
        await db.changeField(
          entityType: 'voter',
          entityId: 'v-1',
          householdId: 'h-1',
          fieldKey: 'name',
          value: 'Synthetic Arjun Rao',
          at: DateTime.utc(2026, 10, 1),
        );
        await pumpEventQueue();
        expect(seen.last!.value('name'), 'Synthetic Arjun Rao');
        expect(await db.watchMemberDetail('v-9').first, isNull);
      },
    );

    test('field definitions by key', () async {
      final defs = await db.watchFieldDefinitions().first;
      expect(defs[casteKey]!.requiresConsent, isTrue);
      expect(defs['occupation']!.enabled, isTrue);
    });

    test('uploaded: the new member’s details take the server’s ids', () async {
      final id = await db.addMember(
        householdId: 'h-1',
        name: 'Synthetic Meera',
        age: 21,
        at: DateTime.utc(2026, 10, 1, 10),
      );
      // Edited again while the member waits to upload.
      await db.changeField(
        entityType: 'voter',
        entityId: id,
        householdId: 'h-1',
        fieldKey: 'age',
        value: 22,
        at: DateTime.utc(2026, 10, 1, 10, 5),
      );
      final api = FakeSyncApi()
        ..answer = (m) => m['type'] == 'member.create'
            ? {
                'status': 'applied',
                'result': {
                  'id': id,
                  'fields': [
                    {
                      'fieldKey': 'name',
                      'status': 'applied',
                      'fieldValueId': 'srv-name',
                    },
                    {
                      'fieldKey': 'age',
                      'status': 'applied',
                      'fieldValueId': 'srv-age',
                    },
                  ],
                },
              }
            : FakeSyncApi.applied(m);
      await PushRepository(db, api).pushDue();
      // The member first; the edit, based on its age, in a batch after it.
      expect(api.pushed.map((b) => b.single['type']), [
        'member.create',
        'field.change',
      ]);
      final sent = api.pushed.first.single['payload']! as Map<String, dynamic>;
      expect(sent, isNot(contains('_fieldValueIds')));
      expect(
        (api.pushed.last.single['payload']!
            as Map<String, dynamic>)['baseVersion'],
        'srv-age',
      );
      final ids = (await db.select(db.fieldValues).get()).map((v) => v.id);
      expect(ids, containsAll(['srv-name', 'srv-age']));
      expect(await queued(db), isEmpty);
    });
  });

  group('the member screen', () {
    MemberDetail detail({String? epic = 'SYN0000001'}) => MemberDetail(
      voter: VoterRow(
        id: 'v-1',
        householdId: 'h-1',
        partId: 'part-1',
        pollingStationId: 'station-1',
        origin: 'official_import',
        recordStatus: 'active',
        epicNumber: epic,
        official: '{"name":"Synthetic Arjun","age":49,"gender":"male","occupation":"Farmer"}',
        previousVoterIds: const [],
      ),
      current: const {},
    );

    FieldDefinitionRow def(
      String key, {
      bool enabled = true,
      String? options,
    }) => FieldDefinitionRow(
      id: 'fd-$key',
      key: key,
      labelKey: 'field.$key',
      appliesTo: 'voter',
      type: 'text',
      options: options,
      isRestricted: key == casteKey,
      requiresConsent: key == casteKey,
      enabled: enabled,
      purpose: 'Synthetic',
    );

    Map<String, FieldDefinitionRow> defs({
      Set<String> disabled = const {},
      Map<String, String> options = const {},
    }) => {
      for (final k in [
        'name',
        'age',
        'gender',
        'mobile_number',
        'occupation',
        'additional_info',
        casteKey,
      ])
        k: def(k, enabled: !disabled.contains(k), options: options[k]),
    };

    Future<void> show(
      WidgetTester tester, {
      MemberDetail? member,
      Map<String, FieldDefinitionRow>? definitions,
      bool add = false,
      TargetPlatform platform = TargetPlatform.android,
      Locale locale = const Locale('en'),
      double textScale = 1,
      List<BoothAssignment> booths = const [
        BoothAssignment(name: 'Synthetic School', code: '142'),
      ],
      bool tall = true,
    }) async {
      if (tall) {
        // The whole form at once (the list builds only what's on screen).
        tester.view.physicalSize = const Size(800, 2400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
      }
      await tester.pumpWidget(
        ProviderScope(
          key: UniqueKey(),
          overrides: <Override>[
            memberDetailProvider.overrideWith(
              (ref, id) => Stream.value(member ?? detail()),
            ),
            fieldDefinitionsProvider.overrideWith(
              (ref) => Stream.value(definitions ?? defs()),
            ),
            boothsProvider.overrideWith((ref) => Stream.value(booths)),
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
                ? const MemberScreen.add(householdId: 'h-1')
                : const MemberScreen(memberId: 'v-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    String fieldText(WidgetTester tester, String label) => tester
        .widget<TextField>(find.widgetWithText(TextField, label))
        .controller!
        .text;

    testWidgets('every detail, filled from the roll', (tester) async {
      await show(tester);
      expect(find.widgetWithText(AppBar, 'Synthetic Arjun'), findsOneWidget);
      expect(
        find.text('Official list: SYN0000001 · Booth 142'),
        findsOneWidget,
      );
      expect(fieldText(tester, 'Name'), 'Synthetic Arjun');
      expect(fieldText(tester, 'Age'), '49');
      expect(fieldText(tester, 'Occupation'), 'Farmer');
      expect(fieldText(tester, 'Mobile number'), '');
      final gender = tester.widget<SegmentedButton<String>>(
        find.byType(SegmentedButton<String>),
      );
      expect(gender.selected, {'male'});
      expect(find.text('Female'), findsOneWidget);
      expect(find.text('Third gender'), findsOneWidget);
      expect(
        find.text("Don't record health, religion or party details here."),
        findsOneWidget,
      );
    });

    testWidgets('the official reference: EPIC alone, or none', (tester) async {
      await show(
        tester,
        booths: const [
          BoothAssignment(name: 'A', code: '1'),
          BoothAssignment(name: 'B', code: '2'),
        ],
      );
      expect(find.text('Official list: SYN0000001'), findsOneWidget);
      await show(tester, member: detail(epic: null));
      expect(find.textContaining('Official list'), findsNothing);
    });

    testWidgets('caste / community: Sensitive, locked until the voter agrees', (
      tester,
    ) async {
      await show(tester);
      expect(find.text('Caste / community (optional)'), findsOneWidget);
      expect(find.text('Sensitive'), findsOneWidget);
      expect(find.textContaining('only authorised staff'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Caste / community'), findsNothing);
      await tester.ensureVisible(find.text('Voter agrees to share this'));
      await tester.tap(find.text('Voter agrees to share this'));
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(TextField, 'Caste / community'),
        findsOneWidget,
      );
    });

    testWidgets('fields the admin turned off are never shown', (tester) async {
      await show(
        tester,
        definitions: defs(
          disabled: {
            'age',
            'gender',
            'mobile_number',
            casteKey,
            'additional_info',
          },
        ),
      );
      expect(find.widgetWithText(TextField, 'Name'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Occupation'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Age'), findsNothing);
      expect(find.byType(SegmentedButton<String>), findsNothing);
      expect(find.widgetWithText(TextField, 'Mobile number'), findsNothing);
      expect(find.text('Sensitive'), findsNothing);
      expect(find.widgetWithText(TextField, 'Additional info'), findsNothing);

      // No caste definition on the phone: no caste card either.
      await show(tester, definitions: defs()..remove(casteKey));
      expect(find.text('Sensitive'), findsNothing);
    });

    testWidgets('a list to choose from when the field has options', (
      tester,
    ) async {
      await show(
        tester,
        definitions: defs(
          options: {
            'occupation': '[{"value":"Farmer","labelKey":"o.farmer"},{"value":"Teacher","labelKey":"o.teacher"}]',
          },
        ),
      );
      expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Occupation'), findsNothing);
      expect(find.text('Farmer'), findsOneWidget);
    });

    testWidgets('checks what was typed before saving', (tester) async {
      await show(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Name'), '  ');
      await tester.enterText(find.widgetWithText(TextField, 'Age'), '131');
      await tester.enterText(
        find.widgetWithText(TextField, 'Mobile number'),
        '12345',
      );
      await tester.tap(find.byTooltip('Save'));
      await tester.pumpAndSettle();
      expect(find.text('Enter the name.'), findsOneWidget);
      expect(find.text('Enter an age from 0 to 130.'), findsOneWidget);
      expect(
        find.text('Enter a 10-digit mobile number, or + and the country code.'),
        findsOneWidget,
      );
    });

    testWidgets('Save: a check on Android, a text button on iOS', (
      tester,
    ) async {
      await show(tester);
      expect(find.byTooltip('Save'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Save'), findsNothing);
      await show(tester, platform: TargetPlatform.iOS);
      expect(find.widgetWithText(TextButton, 'Save'), findsOneWidget);
      expect(find.byIcon(Icons.check), findsNothing);
    });

    testWidgets('adding: an empty form', (tester) async {
      await show(tester, add: true);
      expect(find.widgetWithText(AppBar, 'Add member'), findsOneWidget);
      expect(fieldText(tester, 'Name'), '');
      expect(find.textContaining('Official list'), findsNothing);
      expect(
        tester
            .widget<SegmentedButton<String>>(
              find.byType(SegmentedButton<String>),
            )
            .selected,
        isEmpty,
      );
    });

    testWidgets('meets the tap-target, label and contrast guidelines', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await show(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('fits a small phone at 2× text', (tester) async {
      tester.view.physicalSize = const Size(320, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      for (final locale in const [Locale('en'), Locale('te')]) {
        await show(tester, locale: locale, textScale: 2, tall: false);
        expect(tester.takeException(), isNull, reason: '$locale');
        for (var i = 0; i < 30; i++) {
          await tester.drag(find.byType(ListView), const Offset(0, -200));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$locale');
        }
      }
    });

    testWidgets('in Telugu', (tester) async {
      await show(tester, locale: const Locale('te'));
      expect(find.text('స్త్రీ'), findsOneWidget);
      expect(find.text('సున్నితమైనది'), findsOneWidget);
    });
  });

  group('in the app, offline', () {
    Future<(ProviderContainer, AppDatabase)> open(
      WidgetTester tester,
      String path,
    ) async {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final container = await startApp(
        tester,
        api: FakeAuthApi(session: true),
        syncApi: FakeSyncApi(List.filled(20, offline, growable: true)),
        connectivity: Stream.value([ConnectivityResult.none]),
      );
      final db = await settle(
        tester,
        container.read(appDatabaseProvider.future),
      );
      await settle(tester, seed(db));
      await go(tester, container, path);
      await waitFor(
        tester,
        () => find.widgetWithText(TextField, 'Name').evaluate().isNotEmpty,
      );
      return (container, db);
    }

    testWidgets('editing and saving queues only what changed', (tester) async {
      final (_, db) = await open(tester, '/member/v-1');
      await tester.enterText(
        find.widgetWithText(TextField, 'Occupation'),
        'Teacher',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Mobile number'),
        '98765 43210',
      );
      await tester.tap(find.text('Female'));
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
      final all = await settle(tester, queued(db));
      expect(all.map((m) => m.type), everyElement('field.change'));
      expect(
        {for (final m in all) payloadOf(m)['fieldKey']: payloadOf(m)['value']},
        {
          'gender': 'female',
          'mobile_number': '+919876543210',
          'occupation': 'Teacher',
        },
      );
      // The household shows it.
      await waitFor(
        tester,
        () => find.textContaining('Teacher').evaluate().isNotEmpty,
      );
      expect(find.textContaining('49 · Female · Teacher'), findsOneWidget);
      expect(find.text('On phone'), findsOneWidget);
    });

    testWidgets('caste: consent first, nothing kept on the phone', (
      tester,
    ) async {
      final (_, db) = await open(tester, '/member/v-1');
      await tester.ensureVisible(find.text('Voter agrees to share this'));
      await tester.tap(find.text('Voter agrees to share this'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Caste / community'),
        'Synthetic community',
      );
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      final all = await settle(tester, queued(db));
      expect(all.map((m) => m.type), ['consent.capture', 'field.change']);
      expect(payloadOf(all.last)['consentId'], payloadOf(all.first)['id']);
      expect(payloadOf(all.last)['value'], 'Synthetic community');
      final caste = await settle(
        tester,
        (db.select(
          db.fieldValues,
        )..where((t) => t.fieldKey.equals(casteKey))).get(),
      );
      expect(caste, isEmpty);

      // Opened again: it says it's waiting, without the value.
      await tester.tap(find.text('Synthetic Arjun'));
      await waitFor(
        tester,
        () =>
            find.textContaining('Recorded on this phone').evaluate().isNotEmpty,
      );
      expect(find.text('Synthetic community'), findsNothing);
    });

    testWidgets('without the consent ticked, caste isn’t saved', (
      tester,
    ) async {
      final (_, db) = await open(tester, '/member/v-1');
      await tester.enterText(find.widgetWithText(TextField, 'Age'), '50');
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      final all = await settle(tester, queued(db));
      expect(all.map((m) => (m.type, payloadOf(m)['fieldKey'])), [
        ('field.change', 'age'),
      ]);
      expect(payloadOf(all.single)['value'], 50);
    });

    testWidgets('adding a member creates them, on the phone and queued', (
      tester,
    ) async {
      final (_, db) = await open(tester, '/household/h-1/members/new');
      await tester.tap(find.byTooltip('Save'));
      await tester.pumpAndSettle();
      expect(find.text('Enter the name.'), findsOneWidget);

      await tester.enterText(
        find.widgetWithText(TextField, 'Name'),
        'Synthetic Meera',
      );
      await tester.enterText(find.widgetWithText(TextField, 'Age'), '21');
      await tester.tap(find.text('Female'));
      await tester.enterText(
        find.widgetWithText(TextField, 'Occupation'),
        'Student',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Save'));
      await waitFor(
        tester,
        () => find.byType(HouseholdScreen).evaluate().isNotEmpty,
      );
      final m = (await settle(tester, queued(db))).single;
      expect(m.type, 'member.create');
      final p = payloadOf(m);
      expect(
        (p['name'], p['age'], p['gender']),
        ('Synthetic Meera', 21, 'female'),
      );
      expect(p['fields'], [
        {'fieldKey': 'occupation', 'value': 'Student'},
      ]);
      await waitFor(
        tester,
        () => find.text('Synthetic Meera').evaluate().isNotEmpty,
      );
      expect(find.text('Members · 2'), findsOneWidget);
      expect(find.text('21 · Female · Student'), findsOneWidget);
    });
  });
}
