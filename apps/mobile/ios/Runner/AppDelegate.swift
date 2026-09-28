import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let glassSettings = GlassSettingsStreamHandler()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // Read by lib/theme/glass_system_settings.dart.
    FlutterEventChannel(
      name: "boothconnect/glass_settings",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    ).setStreamHandler(glassSettings)
  }
}

/// Streams `{reduceTransparency, lowEndDevice}` to Flutter so GlassSurface can
/// fall back to opaque surfaces. Reduce Transparency is the accessibility
/// setting; Low Power Mode counts as a low-end device.
final class GlassSettingsStreamHandler: NSObject, FlutterStreamHandler {
  private var sink: FlutterEventSink?
  private var observers: [NSObjectProtocol] = []

  func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    sink = events
    let names: [Notification.Name] = [
      UIAccessibility.reduceTransparencyStatusDidChangeNotification,
      .NSProcessInfoPowerStateDidChange,
    ]
    observers = names.map { name in
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) {
        [weak self] _ in self?.emit()
      }
    }
    emit()
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
    sink = nil
    return nil
  }

  private func emit() {
    sink?([
      "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
      "lowEndDevice": ProcessInfo.processInfo.isLowPowerModeEnabled,
    ])
  }
}
