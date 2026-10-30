package com.phonebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Relance le relais après un redémarrage du téléphone ou une mise à jour de l'application. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val prefs = Prefs(context)
        if (prefs.enabled && prefs.host.isNotEmpty() && prefs.fp.isNotEmpty()) {
            try {
                context.startForegroundService(Intent(context, BridgeService::class.java))
            } catch (_: Exception) {
            }
        }
    }
}
