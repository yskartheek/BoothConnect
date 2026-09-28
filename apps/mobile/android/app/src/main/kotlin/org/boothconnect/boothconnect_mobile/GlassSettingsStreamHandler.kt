package org.boothconnect.boothconnect_mobile

import android.app.Activity
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import io.flutter.plugin.common.EventChannel
import java.util.function.Consumer

/**
 * Streams `{reduceTransparency, lowEndDevice}` to Flutter so GlassSurface can
 * fall back to opaque surfaces.
 *
 * Android has no "reduce transparency" setting. The closest signal is whether
 * the system allows window blur (API 31+): it is off in battery saver, when
 * the user turns it off in developer options, or on devices that can't blur.
 * Low-RAM devices and battery saver count as low-end.
 */
class GlassSettingsStreamHandler(private val activity: Activity) : EventChannel.StreamHandler {
    private var sink: EventChannel.EventSink? = null
    private var blurEnabled = true

    private val powerSaveReceiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) = emit()
        }

    private val blurListener = Consumer<Boolean> { enabled ->
        blurEnabled = enabled
        emit()
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
        sink = events
        val filter = IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(powerSaveReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            activity.registerReceiver(powerSaveReceiver, filter)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Calls blurListener straight away with the current value.
            activity.windowManager.addCrossWindowBlurEnabledListener(activity.mainExecutor, blurListener)
        }
        emit()
    }

    override fun onCancel(arguments: Any?) {
        activity.unregisterReceiver(powerSaveReceiver)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            activity.windowManager.removeCrossWindowBlurEnabledListener(blurListener)
        }
        sink = null
    }

    private fun emit() {
        val power = activity.getSystemService(PowerManager::class.java)
        val memory = activity.getSystemService(ActivityManager::class.java)
        sink?.success(
            mapOf(
                "reduceTransparency" to !blurEnabled,
                "lowEndDevice" to (memory.isLowRamDevice || power.isPowerSaveMode),
            ),
        )
    }
}
