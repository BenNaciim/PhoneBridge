package com.phonebridge

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import java.io.ByteArrayOutputStream

data class Mms(
    val id: Long, val threadId: Long, val date: Long, val out: Boolean,
    val address: String, val body: String, val images: List<String>, val videos: List<String> = emptyList()
)

/** [label] : « Photo » ou « Vidéo », pour l'aperçu d'un message sans texte. */
data class MmsSummary(val id: Long, val threadId: Long, val date: Long, val out: Boolean, val text: String, val hasMedia: Boolean, val label: String)

private data class MmsContent(val text: String, val images: List<String>, val videos: List<String>, val hasMedia: Boolean, val label: String)

object MmsReader {
    private val URI = Uri.parse("content://mms")
    private val PART_URI = Uri.parse("content://mms/part")

    private fun query(
        ctx: Context, uri: Uri, proj: Array<String>, sel: String?, selArgs: Array<String>?,
        sortCol: String, limit: Int, desc: Boolean = true
    ): Cursor? {
        val b = Bundle().apply {
            putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, arrayOf(sortCol))
            putInt(
                ContentResolver.QUERY_ARG_SORT_DIRECTION,
                if (desc) ContentResolver.QUERY_SORT_DIRECTION_DESCENDING else ContentResolver.QUERY_SORT_DIRECTION_ASCENDING
            )
            putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            if (sel != null) {
                putString(ContentResolver.QUERY_ARG_SQL_SELECTION, sel)
                putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, selArgs)
            }
        }
        return ctx.contentResolver.query(uri, proj, b, null)
    }

    fun maxId(ctx: Context): Long {
        try {
            query(ctx, URI, arrayOf("_id"), null, null, "_id", 1)?.use { if (it.moveToFirst()) return it.getLong(0) }
        } catch (_: Exception) {
        }
        return 0
    }

    fun addressOf(ctx: Context, id: Long, out: Boolean): String? {
        try {
            val type = if (out) "151" else "137"
            ctx.contentResolver.query(
                Uri.parse("content://mms/$id/addr"), arrayOf("address", "type"), "type = ?", arrayOf(type), null
            )?.use {
                while (it.moveToNext()) {
                    val a = it.getString(0)
                    if (!a.isNullOrEmpty() && a != "insert-address-token") return a
                }
            }
        } catch (_: Exception) {
        }
        return null
    }

    private fun readText(ctx: Context, partId: Long): String = try {
        ctx.contentResolver.openInputStream(Uri.parse("content://mms/part/$partId"))?.use { String(it.readBytes()) } ?: ""
    } catch (_: Exception) {
        ""
    }

    /** Texte, photos et vidéos d'un MMS ; les médias ne sont lus que si [withMedia]. */
    private fun content(ctx: Context, id: Long, withMedia: Boolean): MmsContent {
        val text = StringBuilder()
        val images = ArrayList<String>()
        val videos = ArrayList<String>()
        var hasImage = false
        var hasVideo = false
        var videoMissing = false
        try {
            ctx.contentResolver.query(PART_URI, arrayOf("_id", "ct", "text", "_data"), "mid = ?", arrayOf(id.toString()), null)?.use { c ->
                while (c.moveToNext()) {
                    val partId = c.getLong(0)
                    val ct = c.getString(1) ?: ""
                    val uri = Uri.parse("content://mms/part/$partId")
                    if (ct == "text/plain") {
                        text.append(c.getString(2) ?: if (c.getString(3) != null) readText(ctx, partId) else "")
                    } else if (ct.startsWith("image/")) {
                        hasImage = true
                        if (withMedia && images.size < 4) Media.imageFromUri(ctx, uri)?.let { images.add(it) }
                    } else if (ct.startsWith("video/")) {
                        hasVideo = true
                        val v = if (withMedia && videos.size < 2) Media.videoFromUri(ctx, uri, ct) else null
                        if (v != null) videos.add(v) else videoMissing = true
                    }
                }
            }
        } catch (_: Exception) {
        }
        if (videoMissing && withMedia) text.append(if (text.isEmpty()) "🎥 Vidéo (trop lourde pour être affichée sur le PC)" else "\n🎥 Vidéo (trop lourde pour être affichée sur le PC)")
        return MmsContent(text.toString(), images, videos, hasImage || hasVideo, if (hasVideo && !hasImage) "Vidéo" else "Photo")
    }

    fun recentSummaries(ctx: Context, limit: Int): List<MmsSummary> {
        val out = ArrayList<MmsSummary>()
        try {
            query(ctx, URI, arrayOf("_id", "thread_id", "date", "msg_box"), "msg_box IN (1, 2)", null, "date", limit)?.use { c ->
                while (c.moveToNext() && out.size < limit) {
                    val id = c.getLong(0)
                    val m = content(ctx, id, false)
                    if (m.text.isEmpty() && !m.hasMedia) continue
                    out.add(MmsSummary(id, c.getLong(1), c.getLong(2) * 1000, c.getInt(3) == 2, m.text, m.hasMedia, m.label))
                }
            }
        } catch (_: Exception) {
        }
        return out
    }

    fun forThread(ctx: Context, threadId: Long, imageBudget: Int = 15): List<Mms> {
        val out = ArrayList<Mms>()
        try {
            query(
                ctx, URI, arrayOf("_id", "date", "msg_box"), "thread_id = ? AND msg_box IN (1, 2)",
                arrayOf(threadId.toString()), "date", 60
            )?.use { c ->
                var n = 0
                while (c.moveToNext() && n < 60) {
                    n++
                    val id = c.getLong(0)
                    val m = content(ctx, id, out.size < imageBudget)
                    if (m.text.isEmpty() && !m.hasMedia) continue
                    out.add(Mms(id, threadId, c.getLong(1) * 1000, c.getInt(2) == 2, "", m.text, m.images, m.videos))
                }
            }
        } catch (_: Exception) {
        }
        return out
    }

    /** MMS reçus dont l'id dépasse [baseline], déjà téléchargés (au moins un texte ou une image). */
    fun incomingSince(ctx: Context, baseline: Long, skip: Set<Long>): List<Mms> {
        val out = ArrayList<Mms>()
        try {
            query(
                ctx, URI, arrayOf("_id", "thread_id", "date"), "_id > ? AND msg_box = 1",
                arrayOf(baseline.toString()), "_id", 20
            )?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getLong(0)
                    if (id in skip) continue
                    val m = content(ctx, id, true)
                    if (m.text.isEmpty() && !m.hasMedia) continue
                    val address = addressOf(ctx, id, false) ?: continue
                    out.add(Mms(id, c.getLong(1), c.getLong(2) * 1000, false, address, m.text, m.images, m.videos))
                }
            }
        } catch (_: Exception) {
        }
        return out
    }
}
