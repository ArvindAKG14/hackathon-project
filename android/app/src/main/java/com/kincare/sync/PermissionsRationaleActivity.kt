package com.kincare.sync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Shown by Health Connect when the user asks why we want their data. */
class PermissionsRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(24.dp)) {
                        Text("How KinCare uses your health data", style = MaterialTheme.typography.headlineSmall)
                        Text(
                            "KinCare Sync reads the health data you allow (heart rate, blood pressure, " +
                                "oxygen, temperature, glucose, weight, activity and sleep) and sends it to " +
                                "your family's KinCare dashboard, so the relatives you have linked can see " +
                                "it. It only reads data when you tap Sync, never writes to Health Connect, " +
                                "and you can turn access off at any time in Health Connect settings.",
                            modifier = Modifier.padding(top = 16.dp),
                        )
                    }
                }
            }
        }
    }
}
