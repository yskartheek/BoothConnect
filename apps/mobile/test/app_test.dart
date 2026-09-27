import 'package:boothconnect_mobile/app/app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('app starts on the home screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: BoothConnectApp()));
    await tester.pumpAndSettle();

    expect(find.widgetWithText(AppBar, 'BoothConnect'), findsOneWidget);
    expect(find.text('Welcome to BoothConnect'), findsOneWidget);
    expect(
      find.text('Sign-in and your assigned households will appear here.'),
      findsOneWidget,
    );
  });
}
