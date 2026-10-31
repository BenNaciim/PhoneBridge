package com.phonebridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

/** Photos et vidéos envoyées au PC sous forme d'adresses « data: » (aucun fichier intermédiaire). */
object Media {
    const val MAX_VIDEO_BYTES = 6_000_000

    /** JPEG de 900 px au plus, qualité 72 : assez net pour une discussion, léger sur le Wi-Fi. */
    fun jpegDataUrl(bmp: Bitmap): String {
        val scale = 900f / maxOf(bmp.width, bmp.height)
        val small = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
        val bos = ByteArrayOutputStream()
        small.compress(Bitmap.CompressFormat.JPEG, 72, bos)
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
    }

    /** Image lisible à cette adresse (MMS, pièce jointe d'une notification), ou null si l'accès est refusé. */
    fun imageFromUri(ctx: Context, uri: Uri): String? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        val bmp = ctx.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        }
        bmp?.let { jpegDataUrl(it) }
    } catch (_: Exception) {
        null
    }

    /** Vidéo de 6 Mo au plus ; au-delà, ou sans accès, null (le PC affiche alors seulement une mention). */
    fun videoFromUri(ctx: Context, uri: Uri, mime: String): String? = try {
        ctx.contentResolver.openInputStream(uri)?.use { input ->
            val bos = ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                bos.write(buf, 0, n)
                if (bos.size() > MAX_VIDEO_BYTES) return@use null
            }
            "data:$mime;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
        }
    } catch (_: Exception) {
        null
    }
}
