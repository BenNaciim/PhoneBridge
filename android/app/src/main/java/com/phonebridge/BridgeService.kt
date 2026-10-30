package com.phonebridge

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.net.ConnectivityManager
import android.net.Network
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.CallLog
import android.provider.Telephony
import android.telephony.SmsManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

class BridgeService : Service() {
    private val baseClient = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private val handler = Handler(Looper.getMainLooper())
    private val retry = Runnable { connect() }

    private var started = false
    private var stopped = false
    private var startedAt = 0L
    private var retryMs = 2000L
    private var failures = 0
    private var current: WebSocket? = null
    private var discovering = false
    private var wifiLock: WifiManager.WifiLock? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = sendBattery(i)
    }

    private var lastCallId = -1L
    private val callObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) {
            Thread { pushCalls(announceMissed = true) }.start()
        }
    }

    private var mmsBaseline = -1L
    private val mmsSent = HashSet<Long>()
    private val mmsObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) {
            handler.postDelayed({ Thread { pushNewMms() }.start() }, 1500)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("bridge", "Connexion au PC", NotificationManager.IMPORTANCE_LOW))
        val notif = Notification.Builder(this, "bridge")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("PhoneBridge")
            .setContentText("Relais vers votre PC actif")
            .setOngoing(true)
            .build()
        startForeground(1, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)

        if (started) {
            reconnectNow()
            return START_STICKY
        }
        started = true
        stopped = false
        startedAt = System.currentTimeMillis()

        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        contentResolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, callObserver)
        try {
            contentResolver.registerContentObserver(Telephony.Mms.CONTENT_URI, true, mmsObserver)
        } catch (_: Exception) {
        }
        holdWifi()
        watchNetwork()
        connect()
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        handler.removeCallbacksAndMessages(null)
        try { unregisterReceiver(batteryReceiver) } catch (_: Exception) {}
        contentResolver.unregisterContentObserver(callObserver)
        contentResolver.unregisterContentObserver(mmsObserver)
        netCallback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) {} }
        try { wifiLock?.release() } catch (_: Exception) {}
        Relay.ready = false
        Relay.ws?.close(1000, null)
        Relay.ws = null
        super.onDestroy()
    }

    /** Garde le Wi-Fi éveillé écran éteint, pour que les notifications arrivent sans retard. */
    @Suppress("DEPRECATION")
    private fun holdWifi() {
        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifiLock = wm.createWifiLock(mode, "PhoneBridge").apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) {
        }
    }

    /** Dès qu'un réseau revient (Wi-Fi retrouvé, sortie du mode avion), on se reconnecte sans attendre. */
    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                handler.post {
                    if (!stopped && !Relay.ready && System.currentTimeMillis() - startedAt > 3000) {
                        retryMs = 2000L
                        reconnectNow()
                    }
                }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            netCallback = cb
        } catch (_: Exception) {
        }
    }

    /** N'accepte que le certificat dont l'empreinte figure dans le code de jumelage. */
    @SuppressLint("CustomX509TrustManager", "TrustAllX509TrustManager")
    private fun pinnedClient(fp: String): OkHttpClient {
        val tm = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
                throw CertificateException("Non pris en charge")
            }

            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                val digest = MessageDigest.getInstance("SHA-256").digest(chain[0].encoded)
                val hex = digest.joinToString("") { "%02x".format(it) }
                if (!hex.startsWith(fp.lowercase())) throw CertificateException("Empreinte du PC inattendue")
            }

            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), SecureRandom()) }
        return baseClient.newBuilder()
            .sslSocketFactory(ctx.socketFactory, tm)
            .hostnameVerifier { _, _ -> true }
            .build()
    }

    private fun connect() {
        if (stopped) return
        val prefs = Prefs(this)
        if (prefs.host.isEmpty() || prefs.token.isEmpty() || prefs.fp.isEmpty()) return
        val req = try {
            Request.Builder().url("https://${prefs.host}/").build()
        } catch (_: Exception) {
            return
        }
        val client = pinnedClient(prefs.fp)
        val ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                ws.send(
                    JSONObject().put("t", "hello").put("token", prefs.token)
                        .put("device", Build.MODEL).toString()
                )
            }

            override fun onMessage(ws: WebSocket, text: String) {
                if (ws !== current) return
                val m = try { JSONObject(text) } catch (_: Exception) { return }
                handle(m)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) = lost(ws)
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) = lost(ws)
        })
        current = ws
        Relay.ws = ws
    }

    private fun reconnectNow() {
        handler.removeCallbacks(retry)
        val old = current
        current = null
        Relay.ready = false
        Relay.ws = null
        old?.cancel()
        connect()
    }

    private fun lost(ws: WebSocket) {
        if (ws !== current) return
        current = null
        Relay.ready = false
        Relay.ws = null
        if (stopped) return
        failures++
        // Plusieurs échecs de suite : l'adresse du PC a peut-être changé, on le recherche sur le réseau.
        if (failures >= 2 && failures % 3 == 2) discover()
        handler.postDelayed(retry, retryMs)
        retryMs = (retryMs * 2).coerceAtMost(30000L)
    }

    @Suppress("DEPRECATION")
    private fun discover() {
        if (discovering) return
        discovering = true
        val nsd = getSystemService(NsdManager::class.java)
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, code: Int) { discovering = false }
            override fun onStopDiscoveryFailed(type: String, code: Int) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                if (!info.serviceType.contains("phonebridge")) return
                nsd.resolveService(info, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(i: NsdServiceInfo, code: Int) {}
                    override fun onServiceResolved(i: NsdServiceInfo) {
                        val addr = i.host as? Inet4Address ?: return
                        val found = "${addr.hostAddress}:${i.port}"
                        val prefs = Prefs(this@BridgeService)
                        if (found != prefs.host) {
                            prefs.host = found
                            handler.post { if (!stopped && !Relay.ready) reconnectNow() }
                        }
                    }
                })
            }
        }
        try {
            nsd.discoverServices("_phonebridge._tcp", NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            discovering = false
            return
        }
        handler.postDelayed({
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {}
            discovering = false
        }, 8000)
    }

    private fun handle(m: JSONObject) {
        when (m.optString("t")) {
            "welcome" -> {
                Relay.ready = true
                failures = 0
                retryMs = 2000L
                registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.let { sendBattery(it) }
                NotifListener.instance?.pushAll()
                Thread { mmsBaseline = MmsReader.maxId(this) }.start()
            }
            "get_calls" -> pushCalls(announceMissed = false)
            "get_threads" -> Relay.send(JSONObject().put("t", "sms_list").put("threads", SmsReader.threads(this)))
            "get_thread" -> {
                val id = m.optLong("threadId")
                Relay.send(
                    JSONObject().put("t", "sms_thread").put("threadId", id)
                        .put("messages", SmsReader.thread(this, id))
                )
            }
            "send_sms" -> sendSms(m.optString("to"), m.optString("body"))
            "send_mms" -> sendMms(m)
            "reply_notif" -> NotifListener.instance?.reply(m.optString("key"), m.optString("text"))
            "dismiss_notif" -> NotifListener.instance?.dismiss(m.optString("key"))
        }
    }

    private fun pushCalls(announceMissed: Boolean) {
        val calls = CallReader.recent(this)
        Relay.send(JSONObject().put("t", "calls").put("calls", JSONArray(calls)))
        val newest = calls.maxOfOrNull { it.getLong("id") } ?: return
        if (announceMissed && lastCallId >= 0) {
            calls.filter { it.getLong("id") > lastCallId && it.getString("kind") == "missed" }
                .forEach { Relay.send(JSONObject(it.toString()).put("t", "call_missed")) }
        }
        lastCallId = maxOf(lastCallId, newest)
    }

    private fun pushNewMms() {
        if (mmsBaseline < 0 || !Relay.ready) return
        for (m in MmsReader.incomingSince(this, mmsBaseline, mmsSent)) {
            mmsSent.add(m.id)
            Relay.send(
                JSONObject()
                    .put("t", "sms_new")
                    .put("id", 1_000_000_000L + m.id)
                    .put("threadId", m.threadId)
                    .put("address", m.address)
                    .put("name", SmsReader.contactName(this, m.address))
                    .put("body", m.body)
                    .put("images", JSONArray(m.images))
                    .put("date", m.date)
            )
        }
    }

    private fun sendSms(to: String, body: String) {
        if (to.isEmpty() || body.isEmpty()) return
        try {
            val sms = getSystemService(SmsManager::class.java)
            sms.sendMultipartTextMessage(to, null, sms.divideMessage(body), null, null)
        } catch (_: Exception) {
        }
    }

    private fun sendMms(m: JSONObject) {
        val to = m.optString("to")
        val threadId = m.optLong("threadId")
        val report = { ok: Boolean, error: String? ->
            val r = JSONObject().put("t", "mms_result").put("threadId", threadId).put("ok", ok)
            if (error != null) r.put("error", error)
            Relay.send(r)
        }
        Thread {
            try {
                val image = android.util.Base64.decode(m.optString("data"), android.util.Base64.DEFAULT)
                if (to.isBlank() || image.isEmpty() || image.size > 1_000_000) {
                    report(false, "Photo invalide ou trop lourde")
                } else {
                    MmsSender.send(this, to, m.optString("body"), image, m.optString("mime", "image/jpeg"), report)
                }
            } catch (e: Exception) {
                report(false, e.message ?: "Envoi impossible")
            }
        }.start()
    }

    private fun sendBattery(i: Intent) {
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        if (level >= 0) Relay.send(JSONObject().put("t", "battery").put("pct", level * 100 / scale))
    }
}
