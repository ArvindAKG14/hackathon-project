package com.kincare.sync

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks to the KinCare backend's device endpoints (backend/src/routes/devices.ts).
 * Calls block, so run them on Dispatchers.IO.
 */
class BackendClient(baseUrl: String) {

    private val baseUrl = baseUrl.trim().trimEnd('/')

    class HttpError(val status: Int, message: String) : Exception(message)

    data class Pairing(val deviceId: String, val token: String)

    data class SyncSummary(
        val sent: Int,
        val accepted: Int,
        val skipped: Int,
        /** Rows newly written to the database; repeats of earlier syncs count as 0. */
        val storedMeasurements: Int,
        val storedBloodPressure: Int,
        val storedSleep: Int,
        val alerts: Int,
    )

    /** Exchanges a pairing code from the dashboard for this phone's device token. */
    fun pair(code: String, deviceName: String): Pairing {
        val body = JSONObject()
            .put("code", code)
            .put("platform", "health_connect")
            .put("name", deviceName)
        val json = post("/api/devices/pair", body, token = null)
        return Pairing(
            deviceId = json.getJSONObject("device").getString("id"),
            token = json.getString("token"),
        )
    }

    /** Uploads records in batches under the backend's 1000-per-request limit. */
    fun sync(token: String, records: List<JSONObject>): SyncSummary {
        var summary = SyncSummary(0, 0, 0, 0, 0, 0, 0)
        for (batch in records.chunked(BATCH_SIZE)) {
            val json = post("/api/devices/sync", JSONObject().put("samples", JSONArray(batch)), token)
            val stored = json.optJSONObject("stored") // null when the backend has no database
            summary = summary.copy(
                sent = summary.sent + batch.size,
                accepted = summary.accepted + json.optInt("accepted"),
                skipped = summary.skipped + json.optInt("skipped"),
                storedMeasurements = summary.storedMeasurements + (stored?.optInt("measurements") ?: 0),
                storedBloodPressure = summary.storedBloodPressure + (stored?.optInt("bloodPressure") ?: 0),
                storedSleep = summary.storedSleep + (stored?.optInt("sleep") ?: 0),
                alerts = summary.alerts + (stored?.optInt("alerts") ?: 0),
            )
        }
        return summary
    }

    private fun post(path: String, body: JSONObject, token: String?): JSONObject {
        val conn = URL(baseUrl + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }

            val status = conn.responseCode
            val stream = if (status < 400) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (status >= 400) throw HttpError(status, json.optString("error", "HTTP $status"))
            return json
        } finally {
            conn.disconnect()
        }
    }

    private companion object {
        const val BATCH_SIZE = 500
    }
}
