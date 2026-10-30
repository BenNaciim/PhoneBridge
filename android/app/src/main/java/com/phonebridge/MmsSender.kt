package com.phonebridge

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.telephony.SmsManager
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException

/** Construit un MMS « M-Send.req » (OMA MMS 1.2) : une photo et, si présent, un texte. */
object MmsPdu {
    private fun ByteArrayOutputStream.text(s: String) {
        write(s.toByteArray(Charsets.UTF_8))
        write(0)
    }

    /** Entier de longueur variable des en-têtes WSP : 7 bits par octet, bit de poids fort = suite. */
    private fun uintvar(value: Int): ByteArray {
        val parts = ArrayList<Int>()
        var v = value
        parts.add(v and 0x7F)
        v = v ushr 7
        while (v > 0) {
            parts.add((v and 0x7F) or 0x80)
            v = v ushr 7
        }
        return ByteArray(parts.size) { parts[parts.size - 1 - it].toByte() }
    }

    private fun address(to: String): String {
        val n = to.replace(Regex("[\\s().-]"), "")
        return if (Regex("^\\+?[0-9*#]+$").matches(n)) "$n/TYPE=PLMN" else n
    }

    private fun part(contentType: ByteArray, name: String, data: ByteArray): ByteArray {
        val headers = ByteArrayOutputStream().apply {
            write(contentType)
            write(0x8E); text(name)          // Content-Location
            write(0xC0); text("<$name>")     // Content-Id
        }.toByteArray()
        return ByteArrayOutputStream().apply {
            write(uintvar(headers.size))
            write(uintvar(data.size))
            write(headers)
            write(data)
        }.toByteArray()
    }

    fun sendReq(to: String, body: String, image: ByteArray, mime: String): ByteArray {
        val parts = ArrayList<ByteArray>()
        val isPng = mime.equals("image/png", ignoreCase = true)
        parts.add(part(byteArrayOf(if (isPng) 0xA0.toByte() else 0x9E.toByte()), if (isPng) "photo.png" else "photo.jpg", image))
        if (body.isNotBlank()) {
            // text/plain; charset=utf-8
            parts.add(part(byteArrayOf(0x03, 0x83.toByte(), 0x81.toByte(), 0xEA.toByte()), "text.txt", body.toByteArray(Charsets.UTF_8)))
        }
        return ByteArrayOutputStream().apply {
            write(0x8C); write(0x80)                         // type : m-send-req
            write(0x98); text("pb" + System.currentTimeMillis()) // identifiant de transaction
            write(0x8D); write(0x92)                         // version 1.2
            write(0x89); write(0x01); write(0x81)            // expéditeur : le réseau remplit
            write(0x97); text(address(to))                   // destinataire
            write(0x84); write(0xA3)                         // application/vnd.wap.multipart.mixed
            write(uintvar(parts.size))
            parts.forEach { write(it) }
        }.toByteArray()
    }
}

/** Sert le fichier MMS à envoyer au service système (accès accordé à lui seul, supprimé après l'envoi). */
class MmsFileProvider : ContentProvider() {
    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val dir = File(context!!.cacheDir, "mms")
        val f = File(dir, uri.lastPathSegment ?: throw FileNotFoundException())
        if (f.parentFile?.canonicalPath != dir.canonicalPath || !f.exists()) throw FileNotFoundException()
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, v: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}

object MmsSender {
    private val SYSTEM_PACKAGES = listOf("com.android.phone", "com.android.mms.service")

    private fun describe(code: Int) = when (code) {
        SmsManager.MMS_ERROR_NO_DATA_NETWORK -> "Pas de données mobiles : activez-les pour envoyer un MMS."
        SmsManager.MMS_ERROR_UNABLE_CONNECT_MMS -> "Connexion MMS impossible (données mobiles ou réglages MMS de l'opérateur)."
        SmsManager.MMS_ERROR_INVALID_APN, SmsManager.MMS_ERROR_CONFIGURATION_ERROR -> "Réglages MMS (APN) de l'opérateur invalides."
        SmsManager.MMS_ERROR_HTTP_FAILURE -> "L'opérateur a refusé le MMS (photo trop lourde ?)."
        else -> "Échec de l'envoi du MMS (code $code)."
    }

    fun send(ctx: Context, to: String, text: String, image: ByteArray, mime: String, onResult: (Boolean, String?) -> Unit) {
        val dir = File(ctx.cacheDir, "mms").apply { mkdirs() }
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 10 * 60_000L }?.forEach { it.delete() }
        val file = File(dir, "send_${System.nanoTime()}.dat")
        file.writeBytes(MmsPdu.sendReq(to, text, image, mime))
        val uri = Uri.parse("content://com.phonebridge.mms/${file.name}")
        for (pkg in SYSTEM_PACKAGES) {
            try { ctx.grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
        }
        val action = "com.phonebridge.MMS_SENT.${file.name}"
        fun cleanup() {
            file.delete()
            try { ctx.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                try { c.unregisterReceiver(this) } catch (_: Exception) {}
                cleanup()
                val ok = resultCode == Activity.RESULT_OK
                onResult(ok, if (ok) null else describe(resultCode))
            }
        }
        val filter = IntentFilter(action)
        if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else ctx.registerReceiver(receiver, filter)
        try {
            val pi = PendingIntent.getBroadcast(ctx, 0, Intent(action).setPackage(ctx.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)
            ctx.getSystemService(SmsManager::class.java).sendMultimediaMessage(ctx, uri, null, null, pi)
        } catch (e: Exception) {
            try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {}
            cleanup()
            onResult(false, e.message ?: "Envoi impossible")
        }
    }
}
