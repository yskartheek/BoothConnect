import 'dart:io';

import 'package:boothconnect_mobile/data/local/app_database.dart';
import 'package:boothconnect_mobile/data/local/database_key.dart';
import 'package:boothconnect_mobile/data/local/local_reads.dart';
import 'package:boothconnect_mobile/data/local/local_store.dart';
import 'package:boothconnect_mobile/features/auth/auth_controller.dart';
import 'package:boothconnect_mobile/features/households/household_address_screen.dart';
import 'package:boothconnect_mobile/features/households/household_screen.dart';
import 'package:boothconnect_mobile/features/members/member_screen.dart';
import 'package:boothconnect_mobile/features/visit/visit_screen.dart';
import 'package:boothconnect_mobile/l10n/generated/app_localizations.dart';
import 'package:boothconnect_mobile/theme/app_theme.dart';
import 'package:boothconnect_mobile/widgets/states.dart';
import 'package:boothconnect_mobile/widgets/sync_status_chip.dart';
import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override, ProviderListenable;
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_auth_api.dart';
import '../support/memory_secrets.dart';

// Synthetic data only.
const household = HouseholdRow(
  id: 'h-1',
  partId: 'part-1',
  pollingStationId: 'station-1',
  displayAddress: '12/4 Gandhi Road',
  houseKey: '12/4',
  structuredAddress:
      '{"house_no":"12/4","street":"Gandhi Road","area":"Nehru Nagar",'
      '"landmark":"Near water tank","pin_code":"500038"}',
  latitude: 17.4,
  longitude: 78.5,
  accuracyM: 11.6,
  origin: 'official_import',
  status: 'active',
);

final visited = HouseholdSummary(
  id: 'h-1',
  address: '12/4 Gandhi Road',
  houseKey: '12/4',
  members: 3,
  lastOutcome: 'follow_up_requested',
  lastVisitAt: DateTime(2026, 9, 26, 10),
  onPhone: 1,
);

const members = [
  MemberCard(
    id: 'v-1',
    name: 'Synthetic Lakshmi Rao',
    age: 46,
    gender: 'female',
    occupation: 'Teacher',
  ),
  MemberCard(id: 'v-2', name: 'Synthetic Arjun Rao', age: 49, gender: 'male'),
  MemberCard(id: 'v-3', name: 'Synthetic Meera'),
];

class _SignedIn extends AuthController {
  @override
  AuthStatus build() => AuthStatus.signedIn;
}

void main() {
  group('member cards come from the local database', () {
    // A real clock: Drift watches don't settle on a widget test's fake clock.
    late Directory dir;
    late LocalStore store;
    late ProviderContainer container;
    late AppDatabase db;

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('bc_household_test');
      store = LocalStore(
        directory: () async => dir,
        keys: DatabaseKeyStore(MemorySecrets()),
        inBackground: false,
      );
      container = ProviderContainer(
        overrides: [
          localStoreProvider.overrideWithValue(store),
          authProvider.overrideWith(_SignedIn.new),
        ],
      );
      db = await container.read(appDatabaseProvider.future);
    });
    tearDown(() async {
      container.dispose();
      await store.wipe();
      dir.deleteSync(recursive: true);
    });

    /// The provider's latest value, once the watch has caught up.
    Future<T> latest<T>(ProviderListenable<AsyncValue<T>> provider) async {
      final values = <T>[];
      final sub = container.listen(provider, (_, next) {
        if (next.hasValue) values.add(next.value as T);
      }, fireImmediately: true);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      sub.close();
      return values.last;
    }

    Future<void> voter(
      String id,
      String official, {
      int? serial,
      String householdId = 'h-1',
      String status = 'active',
      String origin = 'official_import',
    }) => db
        .into(db.voters)
        .insert(
          VotersCompanion.insert(
            id: id,
            householdId: householdId,
            partId: 'part-1',
            pollingStationId: 'station-1',
            origin: origin,
            recordStatus: status,
            sectionNo: Value(serial == null ? null : 1),
            serialNo: Value(serial),
            official: official,
            previousVoterIds: const [],
          ),
        );

    var n = 0;
    Future<void> detail(
      String voterId,
      String key,
      String json, {
      bool current = true,
      int day = 20,
    }) => db
        .into(db.fieldValues)
        .insert(
          FieldValuesCompanion.insert(
            id: 'fv-${n++}',
            entityType: 'voter',
            entityId: voterId,
            fieldKey: key,
            value: json,
            sourceType: 'volunteer_collected',
            collectedAt: DateTime.utc(2026, 9, day),
            isCurrent: current,
          ),
        );

    test('the current details, else the roll’s, in roll order', () async {
      await voter(
        'v-2',
        '{"name":"Synthetic Two","age":49,"gender":"male"}',
        serial: 12,
      );
      await voter(
        'v-1',
        '{"name":"Synthetic One","age":45,"gender":"female"}',
        serial: 11,
      );
      // Added by volunteers: no roll record, details as field values.
      await voter('v-9', 'null', origin: 'volunteer_added');
      await detail('v-9', 'name', '"Synthetic Zed"');
      await voter('v-8', 'null', origin: 'volunteer_added');
      await detail('v-8', 'name', '"synthetic added"');
      await detail('v-8', 'age', '19');
      // Not shown: deleted from the roll, or another household.
      await voter(
        'v-3',
        '{"name":"Synthetic Gone"}',
        serial: 3,
        status: 'deleted',
      );
      await voter(
        'v-4',
        '{"name":"Synthetic Next Door"}',
        serial: 4,
        householdId: 'h-2',
      );

      // Corrections: the latest current value wins; old ones don't count.
      await detail('v-1', 'age', '46');
      await detail('v-1', 'occupation', '"Teacher"');
      await detail('v-1', 'name', '"Synthetic Old"', current: false, day: 25);
      await detail('v-1', 'name', '"Synthetic Earlier"', day: 10);
      await detail('v-1', 'name', '"Synthetic Latest"', day: 21);

      final cards = await db.watchMemberCards('h-1').first;
      expect(cards.map((c) => c.id), ['v-1', 'v-2', 'v-8', 'v-9']);

      final one = cards.first;
      expect(one.name, 'Synthetic Latest');
      expect(one.age, 46);
      expect(one.gender, 'female');
      expect(one.occupation, 'Teacher');
      expect(one.initials, 'SL');

      final two = cards[1];
      expect((two.name, two.age, two.gender), ('Synthetic Two', 49, 'male'));
      expect(two.occupation, isNull);

      expect((cards[2].name, cards[2].age), ('synthetic added', 19));
      expect(cards[2].gender, isNull);
    });

    test('a value of the wrong type is left out, not shown', () async {
      await voter('v-1', '{"name":"Synthetic One","age":"forty"}', serial: 1);
      await detail('v-1', 'gender', '7');
      await detail('v-1', 'occupation', '"  "');
      final card = (await db.watchMemberCards('h-1').first).single;
      expect(card.name, 'Synthetic One');
      expect((card.age, card.gender, card.occupation), (null, null, null));
    });

    test('fields no longer collected', () async {
      Future<void> definition(String key, {required bool enabled}) => db
          .into(db.fieldDefinitions)
          .insert(
            FieldDefinitionsCompanion.insert(
              id: 'fd-$key',
              key: key,
              labelKey: 'field.$key',
              appliesTo: 'voter',
              type: 'text',
              isRestricted: false,
              requiresConsent: false,
              enabled: enabled,
              purpose: 'Synthetic',
            ),
          );
      await definition('occupation', enabled: false);
      await definition('age', enabled: true);
      await definition('religion', enabled: false);
      expect(await db.watchDisabledFieldKeys().first, {
        'occupation',
        'religion',
      });
    });

    test('one household’s summary, with when it was last visited', () async {
      for (final id in ['h-1', 'h-2']) {
        await db
            .into(db.households)
            .insert(
              HouseholdsCompanion.insert(
                id: id,
                partId: 'part-1',
                pollingStationId: 'station-1',
                displayAddress: '$id Synthetic Street',
                houseKey: id,
                origin: 'official_import',
                status: 'active',
              ),
            );
      }
      for (final (id, day) in [('c-1', 20), ('c-2', 26), ('c-3', 22)]) {
        await db
            .into(db.visits)
            .insert(
              VisitsCompanion.insert(
                clientId: id,
                householdId: 'h-1',
                volunteerId: 'u-1',
                startedAt: DateTime.utc(2026, 9, day),
                outcome: day == 26 ? 'follow_up_requested' : 'completed',
                formVersion: '1',
                memberIdsMet: const [],
              ),
            );
      }
      final one = await db.watchHouseholdSummaries(householdId: 'h-1').first;
      expect(one.single.id, 'h-1');
      expect(
        one.single.lastVisitAt!.isAtSameMomentAs(DateTime.utc(2026, 9, 26)),
        isTrue,
      );
      expect(one.single.lastOutcome, 'follow_up_requested');
      final two = await db.watchHouseholdSummaries(householdId: 'h-2').first;
      expect(two.single.lastVisitAt, isNull);
      expect(await db.watchHouseholdSummaries().first, hasLength(2));
      expect(
        await db.watchHouseholdSummaries(householdId: 'h-9').first,
        isEmpty,
      );
    });

    test('the screen’s providers read that household', () async {
      for (final id in ['h-1', 'h-2']) {
        await db
            .into(db.households)
            .insert(
              HouseholdsCompanion.insert(
                id: id,
                partId: 'part-1',
                pollingStationId: 'station-1',
                displayAddress: '$id Synthetic Street',
                houseKey: id,
                origin: 'official_import',
                status: 'active',
              ),
            );
        await voter(
          'v-$id',
          '{"name":"Synthetic $id"}',
          serial: 1,
          householdId: id,
        );
      }
      expect((await latest(householdProvider('h-2')))!.id, 'h-2');
      expect((await latest(householdSummaryProvider('h-2')))!.id, 'h-2');
      expect(await latest(householdSummaryProvider('h-9')), isNull);
      expect((await latest(memberCardsProvider('h-2'))).map((m) => m.id), [
        'v-h-2',
      ]);
      expect(await latest(disabledFieldsProvider), isEmpty);
    });
  });

  group('the household screen', () {
    List<Override> data({
      HouseholdRow? row = household,
      HouseholdSummary? summary,
      bool removed = false,
      List<MemberCard> cards = members,
      Set<String> disabled = const {},
      Stream<List<MemberCard>>? cardStream,
      Stream<Set<String>>? disabledStream,
    }) => [
      householdProvider.overrideWith((ref, id) => Stream.value(row)),
      householdSummaryProvider.overrideWith(
        (ref, id) => Stream.value(removed ? null : summary ?? visited),
      ),
      memberCardsProvider.overrideWith(
        (ref, id) => cardStream ?? Stream.value(cards),
      ),
      disabledFieldsProvider.overrideWith(
        (ref) => disabledStream ?? Stream.value(disabled),
      ),
    ];

    Future<void> show(
      WidgetTester tester, {
      List<Override>? overrides,
      TargetPlatform platform = TargetPlatform.android,
      Locale locale = const Locale('en'),
      bool settle = true,
      double textScale = 1,
    }) async {
      await tester.pumpWidget(
        ProviderScope(
          // A new scope each time: overrides can't change within one.
          key: UniqueKey(),
          overrides: overrides ?? data(),
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
            home: const HouseholdScreen(householdId: 'h-1'),
          ),
        ),
      );
      // The loading spinner never settles.
      settle ? await tester.pumpAndSettle() : await tester.pump();
    }

    testWidgets('the address card', (tester) async {
      final handle = tester.ensureSemantics();
      await show(tester);
      expect(find.text('12/4 Gandhi Road'), findsOneWidget);
      expect(
        find.text('Nehru Nagar · Near water tank · 500038'),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel('Location saved, accurate to 12 m'),
        findsOneWidget,
      );
      expect(find.text('Last visit Sep 26 · Come back later'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SyncStatusChip),
          matching: find.text('On phone'),
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('not visited, no location, no address details', (tester) async {
      await show(
        tester,
        overrides: data(
          row: household.copyWith(
            structuredAddress: const Value(null),
            latitude: const Value(null),
            longitude: const Value(null),
          ),
          summary: const HouseholdSummary(
            id: 'h-1',
            address: '12/4 Gandhi Road',
            houseKey: '12/4',
            members: 3,
          ),
        ),
      );
      expect(find.text('Not visited yet'), findsOneWidget);
      expect(find.byIcon(Icons.location_on), findsNothing);
      expect(find.textContaining('500038'), findsNothing);
      expect(find.byType(SyncStatusChip), findsNothing);
    });

    testWidgets('a location without an accuracy', (tester) async {
      final handle = tester.ensureSemantics();
      await show(
        tester,
        overrides: data(row: household.copyWith(accuracyM: const Value(null))),
      );
      expect(find.bySemanticsLabel('Location saved'), findsOneWidget);
      handle.dispose();
    });

    testWidgets(
      'a card per member: initials, name, age · gender · occupation',
      (tester) async {
        final handle = tester.ensureSemantics();
        await show(tester);
        expect(find.text('Members · 3'), findsOneWidget);
        expect(find.text('SL'), findsOneWidget);
        expect(find.text('Synthetic Lakshmi Rao'), findsOneWidget);
        expect(find.text('46 · Female · Teacher'), findsOneWidget);
        expect(find.text('49 · Male'), findsOneWidget);
        // Nothing known: no empty line.
        expect(
          find.descendant(
            of: find.widgetWithText(ListTile, 'Synthetic Meera'),
            matching: find.byType(Text),
          ),
          findsNWidgets(2), // initials and name
        );
        // Screen readers hear "Age 46", not a bare number.
        expect(
          tester.getSemantics(
            find.bySemanticsLabel(
              'Synthetic Lakshmi Rao, Age 46, Female, Teacher',
            ),
          ),
          isSemantics(isButton: true, hasTapAction: true),
        );
        handle.dispose();
      },
    );

    testWidgets('fields no longer collected are never shown', (tester) async {
      await show(
        tester,
        overrides: data(
          disabled: {'occupation', 'gender', 'address', 'household_location'},
        ),
      );
      expect(find.text('46'), findsOneWidget);
      expect(find.textContaining('Teacher'), findsNothing);
      expect(find.textContaining('Female'), findsNothing);
      expect(find.textContaining('Nehru Nagar'), findsNothing);
      expect(find.byIcon(Icons.location_on), findsNothing);

      await show(tester, overrides: data(disabled: {'age'}));
      expect(find.text('Female · Teacher'), findsOneWidget);
    });

    testWidgets('no members yet', (tester) async {
      await show(tester, overrides: data(cards: const []));
      expect(find.text('Members · 0'), findsOneWidget);
      expect(find.text('No members yet'), findsOneWidget);
      expect(find.text('Add member'), findsOneWidget);
    });

    testWidgets('a household no longer on the roll', (tester) async {
      Future<void> check(List<Override> overrides) async {
        await show(tester, overrides: overrides);
        expect(find.text('Household not found'), findsOneWidget);
        expect(find.text('Edit'), findsNothing);
        expect(find.text('Start visit'), findsNothing);
      }

      await check(data(row: null));
      // Removed: the row is there, but it has no summary.
      await check(data(removed: true));
    });

    testWidgets('loading, then an error', (tester) async {
      await show(
        tester,
        overrides: data(cardStream: const Stream<List<MemberCard>>.empty()),
        settle: false,
      );
      expect(find.byType(LoadingState), findsOneWidget);
      await show(
        tester,
        overrides: data(
          disabledStream: Stream<Set<String>>.error(StateError('broken')),
        ),
      );
      expect(find.byType(ErrorState), findsOneWidget);
    });

    testWidgets('Start visit: a floating button on Android', (tester) async {
      await show(tester);
      expect(
        find.widgetWithText(FloatingActionButton, 'Start visit'),
        findsOneWidget,
      );
      expect(find.widgetWithText(FilledButton, 'Start visit'), findsNothing);
    });

    testWidgets('Start visit: a bottom button on iOS', (tester) async {
      await show(tester, platform: TargetPlatform.iOS);
      expect(find.byType(FloatingActionButton), findsNothing);
      final button = find.widgetWithText(FilledButton, 'Start visit');
      expect(button, findsOneWidget);
      // Full width, at the bottom, and a comfortable target.
      final size = tester.getSize(button);
      expect(size.height, greaterThanOrEqualTo(44));
      expect(size.width, greaterThan(700));
      expect(
        tester.getBottomLeft(button).dy,
        greaterThan(tester.getSize(find.byType(Scaffold)).height - 80),
      );
    });

    testWidgets('meets the tap-target, label and contrast guidelines', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
        await show(tester, platform: platform);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }
      handle.dispose();
    });

    testWidgets('fits a small phone at 2× text', (tester) async {
      tester.view.physicalSize = const Size(320, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
        for (final locale in const [Locale('en'), Locale('te')]) {
          await show(tester, platform: platform, locale: locale, textScale: 2);
          expect(tester.takeException(), isNull, reason: '$platform $locale');
          // Down to the last member card, a screen at a time.
          while (find
              .text('Synthetic Meera')
              .hitTestable()
              .evaluate()
              .isEmpty) {
            await tester.drag(find.byType(ListView), const Offset(0, -200));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull, reason: '$platform $locale');
          }
        }
      }
    });

    testWidgets('in Telugu', (tester) async {
      await show(tester, locale: const Locale('te'));
      expect(find.text('సభ్యులు · 3'), findsOneWidget);
      expect(find.textContaining('స్త్రీ'), findsOneWidget);
      expect(find.text('సందర్శన ప్రారంభించండి'), findsOneWidget);
    });
  });

  group('in the app', () {
    testWidgets(
      'Edit, Add member, a member and Start visit open their screens',
      (tester) async {
        final container = await startApp(
          tester,
          api: FakeAuthApi(session: true),
          overrides: [
            householdProvider.overrideWith(
              (ref, id) => Stream.value(household),
            ),
            householdSummaryProvider.overrideWith(
              (ref, id) => Stream.value(visited),
            ),
            memberCardsProvider.overrideWith(
              (ref, id) => Stream.value(members),
            ),
            disabledFieldsProvider.overrideWith(
              (ref) => Stream.value(const <String>{}),
            ),
          ],
        );
        await go(tester, container, '/household/h-1');

        Future<T> openAndBack<T extends Widget>(Finder tap) async {
          await tester.tap(tap);
          await tester.pumpAndSettle();
          final screen = tester.widget<T>(find.byType(T));
          // The visit form has Cancel (✕) rather than back.
          final back = find.byType(BackButton);
          await tester.tap(
            back.evaluate().isNotEmpty ? back : find.byTooltip('Cancel'),
          );
          await tester.pumpAndSettle();
          expect(find.byType(HouseholdScreen), findsOneWidget);
          return screen;
        }

        final address = await openAndBack<HouseholdAddressScreen>(
          find.text('Edit'),
        );
        expect(address.householdId, 'h-1');

        final added = await openAndBack<MemberScreen>(find.text('Add member'));
        expect((added.householdId, added.memberId), ('h-1', null));

        final member = await openAndBack<MemberScreen>(
          find.text('Synthetic Arjun Rao'),
        );
        expect((member.householdId, member.memberId), (null, 'v-2'));

        final visit = await openAndBack<VisitScreen>(find.text('Start visit'));
        expect(visit.householdId, 'h-1');
      },
      variant: TargetPlatformVariant.only(TargetPlatform.android),
    );
  });
}
