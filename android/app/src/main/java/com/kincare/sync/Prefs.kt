package com.kincare.sync

import android.content.Context
import androidx.core.content.edit

/** The backend address and this phone's device token, kept between launches. */
class Prefs(context: Context) {

    private val prefs = context.getSharedPreferences("kincare_sync", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "").orEmpty()
        set(value) = prefs.edit { putString("server_url", value) }

    /** Null until paired. The backend only ever shows it once, at pairing. */
    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit { putString("token", value) }
}
