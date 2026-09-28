package org.boothconnect.boothconnect_mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Read by lib/theme/glass_system_settings.dart.
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, "boothconnect/glass_settings")
            .setStreamHandler(GlassSettingsStreamHandler(this))
    }
}
