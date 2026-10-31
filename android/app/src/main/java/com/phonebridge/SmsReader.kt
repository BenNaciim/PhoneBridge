package com.phonebridge

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject

object SmsReader {
    private val names = HashMap<String, String>()

    fun contactName(ctx: Context, address: String): String {
        names[address]?.let { return it }
        var name = address
        try {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(address))
            ctx.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) name = it.getString(0) ?: address
            }
        } catch (_: Exception) {
        }
        names[address] = name
        return name
    }

    private fun latestFirst(limit: Int): Bundle = Bundle().apply {
        putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, arrayOf("date"))
        putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION, ContentResolver.QUERY_SORT_DIRECTION_DESCENDING)
        putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
    }

    /** Contacts avec numéro, triés par nom, un seul par numéro (pour choisir un destinataire sur le PC). */
    fun contacts(ctx: Context): JSONArray {
        val out = JSONArray()
        val seen = HashSet<String>()
        try {
            ctx.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
                null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC"
            )?.use { c ->
                while (c.moveToNext() && out.length() < 3000) {
                    val name = c.getString(0) ?: continue
                    val number = c.getString(1) ?: continue
                    val key = number.filter { it.isDigit() }.takeLast(9)
                    if (key.length < 3 || !seen.add(key)) continue
                    out.put(JSONObject().put("name", name).put("number", number))
                }
            }
        } catch (_: SecurityException) {
        }
        return out
    }

    fun threads(ctx: Context): JSONArray {
        val out = JSONArray()
        val seen = LinkedHashMap<Long, JSONObject>()
        try {
            val args = latestFirst(800)
            ctx.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                arrayOf("thread_id", "address", "body", "date", "type", "read"),
                args, null
            )?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getLong(0)
                    val unread = c.getInt(4) == Telephony.Sms.MESSAGE_TYPE_INBOX && c.getInt(5) == 0
                    val t = seen[id]
                    if (t == null) {
                        val address = c.getString(1) ?: continue
                        seen[id] = JSONObject()
                            .put("id", id)
                            .put("address", address)
                            .put("name", contactName(ctx, address))
                            .put("snippet", c.getString(2) ?: "")
                            .put("date", c.getLong(3))
                            .put("unread", if (unread) 1 else 0)
                    } else if (unread) {
                        t.put("unread", t.getInt("unread") + 1)
                    }
                }
            }
        } catch (_: SecurityException) {
        }
        for (s in MmsReader.recentSummaries(ctx, 150)) {
            val t = seen[s.threadId]
            val snippet = s.text.ifEmpty { s.label }
            if (t == null) {
                val address = MmsReader.addressOf(ctx, s.id, s.out) ?: continue
                seen[s.threadId] = JSONObject()
                    .put("id", s.threadId)
                    .put("address", address)
                    .put("name", contactName(ctx, address))
                    .put("snippet", snippet)
                    .put("date", s.date)
                    .put("unread", 0)
            } else if (s.date > t.getLong("date")) {
                t.put("snippet", snippet).put("date", s.date)
            }
        }
        seen.values.sortedByDescending { it.getLong("date") }.forEach { out.put(it) }
        return out
    }

    fun thread(ctx: Context, threadId: Long): JSONArray {
        val out = JSONArray()
        try {
            val args = latestFirst(200).apply {
                putString(ContentResolver.QUERY_ARG_SQL_SELECTION, "thread_id = ?")
                putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, arrayOf(threadId.toString()))
            }
            ctx.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                arrayOf("_id", "body", "date", "type"),
                args, null
            )?.use { c ->
                while (c.moveToNext()) {
                    out.put(
                        JSONObject()
                            .put("id", c.getLong(0))
                            .put("body", c.getString(1) ?: "")
                            .put("date", c.getLong(2))
                            .put("out", c.getInt(3) != Telephony.Sms.MESSAGE_TYPE_INBOX)
                    )
                }
            }
        } catch (_: SecurityException) {
        }
        for (m in MmsReader.forThread(ctx, threadId)) {
            out.put(
                JSONObject()
                    .put("id", 1_000_000_000L + m.id)
                    .put("body", m.body)
                    .put("date", m.date)
                    .put("out", m.out)
                    .put("images", org.json.JSONArray(m.images))
                    .put("videos", org.json.JSONArray(m.videos))
            )
        }
        return out
    }

    /** Retrouve le fil d'un numéro, utile pour un SMS qui vient d'arriver. */
    fun threadIdFor(ctx: Context, address: String): Long {
        try {
            val args = latestFirst(1).apply {
                putString(ContentResolver.QUERY_ARG_SQL_SELECTION, "address = ?")
                putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, arrayOf(address))
            }
            ctx.contentResolver.query(Telephony.Sms.CONTENT_URI, arrayOf("thread_id"), args, null)?.use {
                if (it.moveToFirst()) return it.getLong(0)
            }
        } catch (_: Exception) {
        }
        return address.hashCode().toLong()
    }
}
