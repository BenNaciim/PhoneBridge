package com.phonebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import org.json.JSONObject

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return
        val address = parts[0].originatingAddress ?: return
        val body = parts.joinToString("") { it.messageBody ?: "" }
        val date = parts[0].timestampMillis
        val app = context.applicationContext
        val pending = goAsync()

        // L'application SMS par défaut enregistre le message juste après : on attend un instant pour retrouver son fil.
        Handler(Looper.getMainLooper()).postDelayed({
            Thread {
                try {
                    Relay.send(
                        JSONObject()
                            .put("t", "sms_new")
                            .put("id", System.currentTimeMillis())
                            .put("threadId", SmsReader.threadIdFor(app, address))
                            .put("address", address)
                            .put("name", SmsReader.contactName(app, address))
                            .put("body", body)
                            .put("date", date)
                    )
                } finally {
                    pending.finish()
                }
            }.start()
        }, 900)
    }
}
