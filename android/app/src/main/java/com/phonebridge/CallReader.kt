package com.phonebridge

import android.content.ContentResolver
import android.content.Context
import android.os.Bundle
import android.provider.CallLog
import org.json.JSONArray
import org.json.JSONObject

object CallReader {
    private fun kind(type: Int) = when (type) {
        CallLog.Calls.MISSED_TYPE -> "missed"
        CallLog.Calls.OUTGOING_TYPE -> "out"
        CallLog.Calls.REJECTED_TYPE -> "rejected"
        CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
        else -> "in"
    }

    fun recent(ctx: Context, limit: Int = 100): List<JSONObject> {
        val out = ArrayList<JSONObject>()
        try {
            val args = Bundle().apply {
                putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, arrayOf(CallLog.Calls.DATE))
                putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION, ContentResolver.QUERY_SORT_DIRECTION_DESCENDING)
                putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            }
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(
                    CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION
                ),
                args, null
            )?.use { c ->
                while (c.moveToNext()) {
                    val number = c.getString(1) ?: ""
                    val name = c.getString(2)?.takeIf { it.isNotEmpty() }
                        ?: if (number.isNotEmpty()) SmsReader.contactName(ctx, number) else "Numéro masqué"
                    out.add(
                        JSONObject()
                            .put("id", c.getLong(0))
                            .put("number", number)
                            .put("name", name)
                            .put("kind", kind(c.getInt(3)))
                            .put("date", c.getLong(4))
                            .put("duration", c.getLong(5))
                    )
                }
            }
        } catch (_: SecurityException) {
        }
        return out
    }
}
