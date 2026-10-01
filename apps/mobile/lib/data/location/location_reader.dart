import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

/// One position fix from the phone.
class LocationFix {
  const LocationFix({
    required this.lat,
    required this.lng,
    this.accuracyM,
    required this.capturedAt,
  });

  final double lat;
  final double lng;
  final double? accuracyM;
  final DateTime capturedAt;
}

/// Why no fix was taken.
enum LocationProblem {
  /// The volunteer refused the permission (this time).
  denied,

  /// Refused for good: only the phone's settings can allow it now.
  deniedForever,

  /// Location is turned off on the phone.
  off,

  /// No fix in time (indoors, no signal).
  unavailable,
}

class LocationFailure implements Exception {
  const LocationFailure(this.problem);

  final LocationProblem problem;

  @override
  String toString() => 'LocationFailure($problem)';
}

/// Takes a single fix when asked, asking for the permission first if
/// needed. Nothing runs in the background and nothing is tracked.
abstract interface class LocationReader {
  /// Throws [LocationFailure].
  Future<LocationFix> current();

  /// Opens the phone's settings for this app (after "denied forever").
  Future<void> openSettings();
}

final locationReaderProvider = Provider<LocationReader>(
  (ref) => const GeolocatorReader(),
);

class GeolocatorReader implements LocationReader {
  const GeolocatorReader();

  /// The API takes accuracies up to 100 km.
  static const _maxAccuracyM = 100000.0;

  @override
  Future<LocationFix> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationFailure(LocationProblem.off);
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    switch (permission) {
      case LocationPermission.denied:
        throw const LocationFailure(LocationProblem.denied);
      case LocationPermission.deniedForever:
        throw const LocationFailure(LocationProblem.deniedForever);
      case LocationPermission.whileInUse ||
          LocationPermission.always ||
          LocationPermission.unableToDetermine:
        break;
    }
    final Position position;
    try {
      position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 30),
        ),
      );
    } on LocationServiceDisabledException {
      throw const LocationFailure(LocationProblem.off);
    } on PermissionDeniedException {
      throw const LocationFailure(LocationProblem.denied);
    } on Exception {
      throw const LocationFailure(LocationProblem.unavailable);
    }
    return LocationFix(
      lat: position.latitude,
      lng: position.longitude,
      accuracyM: position.accuracy > 0
          ? position.accuracy.clamp(0, _maxAccuracyM)
          : null,
      capturedAt: DateTime.now(),
    );
  }

  @override
  Future<void> openSettings() => Geolocator.openAppSettings();
}
