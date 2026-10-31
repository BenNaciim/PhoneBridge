package com.phonebridge

import android.app.Notification
import android.app.Person
import android.app.RemoteInput
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Bundle
import android.provider.Telephony
import android.util.Base64
import java.io.ByteArrayOutputStream
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

class NotifListener : NotificationListenerService() {
    companion object {
        @Volatile var instance: NotifListener? = null
    }

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) = push(sbn)

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        Relay.send(JSONObject().put("t", "notif_removed").put("key", sbn.key))
    }

    fun pushAll() {
        try {
            activeNotifications?.forEach { push(it) }
        } catch (_: Exception) {
        }
    }

    private fun push(sbn: StatusBarNotification) {
        val n = sbn.notification
        if (sbn.packageName == packageName) return
        if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: ""
        if (title.isEmpty() && text.isEmpty()) return

        val label = try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString()
        } catch (_: Exception) {
            sbn.packageName
        }
        val o = JSONObject()
            .put("t", "notif")
            .put("key", sbn.key)
            .put("app", label)
            .put("pkg", sbn.packageName)
            .put("icon", iconOf(sbn.packageName))
            .put("title", title)
            .put("text", text)
            .put("time", sbn.postTime)
            .put("canReply", replyAction(n) != null)
        // Les SMS ont déjà leur propre liste : seules les messageries (Messenger, WhatsApp…) deviennent des conversations.
        if (sbn.packageName != Telephony.Sms.getDefaultSmsPackage(this)) {
            conversation(sbn, title, text)?.let { o.put("conv", it) }
        }
        Relay.send(o)
    }

    /** Conversation d'une notification de messagerie (MessagingStyle) : nom, groupe et derniers messages. */
    @Suppress("DEPRECATION")
    private fun conversation(sbn: StatusBarNotification, title: String, text: String): JSONObject? {
        val n = sbn.notification
        val ex = n.extras
        val template = ex.getString(Notification.EXTRA_TEMPLATE) ?: ""
        // Messagerie : style « conversation », catégorie « message », ou toute notification qui propose une réponse
        // (certaines versions de Messenger n'annoncent ni l'un ni l'autre). Les appels n'en font pas partie.
        val isMessage = n.category == Notification.CATEGORY_MESSAGE || template.endsWith("MessagingStyle") || replyAction(n) != null
        if (!isMessage || n.category == Notification.CATEGORY_CALL) return null
        val convTitle = ex.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString() ?: ""
        val group = ex.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false) || convTitle.isNotEmpty()
        val name = convTitle.ifEmpty { title }
        if (name.isEmpty()) return null

        val me = ex.get(Notification.EXTRA_MESSAGING_PERSON) as? Person
        val myName = me?.name?.toString()
        val msgs = JSONArray()
        for (key in arrayOf(Notification.EXTRA_HISTORIC_MESSAGES, Notification.EXTRA_MESSAGES)) {
            val arr = ex.getParcelableArray(key) ?: continue
            for (p in arr) {
                val b = p as? Bundle ?: continue
                val mime = b.getString("type") ?: ""
                val uri = b.get("uri") as? Uri
                var t = b.getCharSequence("text")?.toString() ?: ""
                if (t.isEmpty() && uri == null) continue
                val person = b.get("sender_person") as? Person
                val sender = person?.name?.toString() ?: b.getCharSequence("sender")?.toString() ?: ""
                val mine = (me != null && person != null && person.key != null && person.key == me.key) ||
                    (myName != null && sender.isNotEmpty() && sender == myName)
                val o = JSONObject().put("time", b.getLong("time", sbn.postTime)).put("sender", sender).put("out", mine)
                // Photo ou vidéo jointe : lue si l'application nous en laisse l'accès, sinon une simple mention.
                if (uri != null && mime.startsWith("image/")) {
                    val img = cachedMedia(uri.toString()) { Media.imageFromUri(this, uri) }
                    if (img != null) o.put("images", JSONArray().put(img)) else if (t.isEmpty()) t = "📷 Photo"
                } else if (uri != null && mime.startsWith("video/")) {
                    val v = cachedMedia(uri.toString()) { Media.videoFromUri(this, uri, mime) }
                    if (v != null) o.put("videos", JSONArray().put(v)) else if (t.isEmpty()) t = "🎥 Vidéo"
                }
                msgs.put(o.put("text", t))
            }
        }
        if (msgs.length() == 0 && text.isNotEmpty()) {
            msgs.put(JSONObject().put("text", text).put("time", sbn.postTime).put("sender", title).put("out", false))
        }
        // Notification « grande image » (BigPictureStyle) : la photo est jointe au dernier message reçu.
        pictureOf(ex)?.let { pic ->
            if (msgs.length() == 0) msgs.put(JSONObject().put("text", "").put("time", sbn.postTime).put("sender", title).put("out", false))
            val last = msgs.getJSONObject(msgs.length() - 1)
            if (!last.has("images")) last.put("images", JSONArray().put(pic))
        }
        return JSONObject().put("id", "${sbn.packageName}|$name").put("name", name).put("group", group).put("messages", msgs)
    }

    /** Médias déjà lus (par adresse), pour ne pas les redécoder à chaque republication de la notification. */
    private val mediaCache = object : LinkedHashMap<String, String?>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String?>) = size > 24
    }

    private fun cachedMedia(key: String, load: () -> String?): String? {
        if (mediaCache.containsKey(key)) return mediaCache[key]
        return load().also { mediaCache[key] = it }
    }

    @Suppress("DEPRECATION")
    private fun pictureOf(ex: Bundle): String? = try {
        val bmp = ex.get(Notification.EXTRA_PICTURE) as? Bitmap
            ?: (ex.get(Notification.EXTRA_PICTURE_ICON) as? android.graphics.drawable.Icon)?.loadDrawable(this)?.let { d ->
                Bitmap.createBitmap(maxOf(1, d.intrinsicWidth), maxOf(1, d.intrinsicHeight), Bitmap.Config.ARGB_8888).also {
                    val cv = android.graphics.Canvas(it)
                    d.setBounds(0, 0, cv.width, cv.height)
                    d.draw(cv)
                }
            }
        bmp?.let { Media.jpegDataUrl(it) }
    } catch (_: Exception) {
        null
    }

    private val iconCache = HashMap<String, String>()

    /** Icône de l'application en PNG 64 px (base64), mise en cache : une seule conversion par application. */
    private fun iconOf(pkg: String): String = iconCache.getOrPut(pkg) {
        try {
            val d = packageManager.getApplicationIcon(pkg)
            val bmp = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
            d.setBounds(0, 0, 64, 64)
            d.draw(Canvas(bmp))
            val bos = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.PNG, 100, bos)
            "data:image/png;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            ""
        }
    }

    private fun replyAction(n: Notification): Notification.Action? =
        n.actions?.firstOrNull { a -> a.remoteInputs?.isNotEmpty() == true && a.actionIntent != null }

    fun reply(key: String, text: String) {
        val sbn = activeNotifications?.firstOrNull { it.key == key } ?: return
        val action = replyAction(sbn.notification) ?: return
        val inputs = action.remoteInputs ?: return
        val results = Bundle()
        inputs.forEach { results.putCharSequence(it.resultKey, text) }
        val intent = Intent()
        RemoteInput.addResultsToIntent(inputs, intent, results)
        try {
            action.actionIntent.send(this, 0, intent)
        } catch (_: Exception) {
        }
    }

    fun dismiss(key: String) {
        try {
            cancelNotification(key)
        } catch (_: Exception) {
        }
    }
}
