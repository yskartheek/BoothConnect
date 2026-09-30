/// Build-time settings for the API.
abstract final class ApiConfig {
  /// The API's origin, without `/v1`. Set it when building:
  /// `flutter run --dart-define=API_BASE_URL=https://api.example.org`.
  /// The default is the development API on the computer running the Android
  /// emulator.
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );
}
