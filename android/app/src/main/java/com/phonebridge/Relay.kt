package com.phonebridge

import android.content.Context
import okhttp3.WebSocket
import org.json.JSONObject

/** Point d'envoi unique vers le PC, partagé par le service, l'écouteur de notifications et le récepteur de SMS. */
object Relay {
    @Volatile var ws: WebSocket? = null
    @Volatile var ready = false

    fun send(o: JSONObject) {
        if (ready) ws?.send(o.toString())
    }
}

class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("bridge", Context.MODE_PRIVATE)
    var host: String
        get() = p.getString("host", "") ?: ""
        set(v) = p.edit().putString("host", v).apply()
    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v).apply()
    /** Début de l'empreinte SHA-256 du certificat du PC (épinglage TLS). */
    var fp: String
        get() = p.getString("fp", "") ?: ""
        set(v) = p.edit().putString("fp", v).apply()
    var enabled: Boolean
        get() = p.getBoolean("enabled", false)
        set(v) = p.edit().putBoolean("enabled", v).apply()
}
