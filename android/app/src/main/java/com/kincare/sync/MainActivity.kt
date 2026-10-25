package com.kincare.sync

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) { SyncScreen() }
            }
        }
    }
}

@Composable
private fun SyncScreen() {
    val context = LocalContext.current
    val prefs = remember { Prefs(context) }
    val scope = rememberCoroutineScope()

    val sdkStatus = remember { HealthConnectClient.getSdkStatus(context) }
    val client = remember(sdkStatus) {
        if (sdkStatus == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context) else null
    }

    var serverUrl by rememberSaveable { mutableStateOf(prefs.serverUrl) }
    var code by rememberSaveable { mutableStateOf("") }
    var token by remember { mutableStateOf(prefs.token) }
    var granted by remember { mutableStateOf(emptySet<String>()) }
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    suspend fun refreshGranted() {
        client?.let { granted = it.permissionController.getGrantedPermissions() }
    }

    LaunchedEffect(client) { refreshGranted() }

    val permissionLauncher = rememberLauncherForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { scope.launch { refreshGranted() } }

    /** Runs one action at a time and shows its outcome (or error) as the status line. */
    fun launchAction(action: suspend () -> String) {
        scope.launch {
            busy = true
            status = try {
                action()
            } catch (e: BackendClient.HttpError) {
                if (e.status == 401) {
                    // Tokens live in the backend's memory, so a backend restart also lands here.
                    prefs.token = null
                    token = null
                    "This phone is no longer paired (disconnected, or the backend restarted). Pair again."
                } else {
                    "Backend error ${e.status}: ${e.message}"
                }
            } catch (e: Exception) {
                "Error: ${e.message ?: e.javaClass.simpleName}"
            }
            busy = false
        }
    }

    fun sync(hours: Long) = launchAction {
        val hc = client ?: error("Health Connect is not available")
        val end = Instant.now()
        val records = HealthReader(hc).read(end.minus(Duration.ofHours(hours)), end, granted)
        if (records.isEmpty()) {
            return@launchAction "No Health Connect data in the last $hours hours. Check that Samsung Health " +
                "shares to Health Connect (Samsung Health > Settings > Health Connect)."
        }
        val s = withContext(Dispatchers.IO) { BackendClient(prefs.serverUrl).sync(token!!, records) }
        "Sent ${s.sent} records (${s.skipped} not used).\n" +
            "New in the database: ${s.storedMeasurements} measurements, ${s.storedBloodPressure} blood " +
            "pressure, ${s.storedSleep} sleep. Alerts raised: ${s.alerts}.\n" +
            "Already-synced data is not stored twice, so 0 new is normal on a repeat sync."
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("KinCare Sync", style = MaterialTheme.typography.headlineMedium)
        Text("Sends this phone's Health Connect data to the family's KinCare dashboard.")

        HorizontalDivider()
        Text("1. Connect to KinCare", style = MaterialTheme.typography.titleMedium)
        if (token == null) {
            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it },
                label = { Text("Backend address") },
                placeholder = { Text("https://….trycloudflare.com") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.uppercase() },
                label = { Text("Pairing code") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = !busy && serverUrl.isNotBlank() && code.isNotBlank(),
                onClick = {
                    launchAction {
                        val url = serverUrl.trim().trimEnd('/')
                        val pairing = withContext(Dispatchers.IO) {
                            BackendClient(url).pair(code.trim(), "${Build.MANUFACTURER} ${Build.MODEL}")
                        }
                        prefs.serverUrl = url
                        prefs.token = pairing.token
                        token = pairing.token
                        code = ""
                        "Paired. Next, allow Health Connect access."
                    }
                },
            ) { Text("Pair") }
        } else {
            Text("Paired with ${prefs.serverUrl}")
            OutlinedButton(onClick = {
                prefs.token = null
                token = null
                status = "Unpaired."
            }) { Text("Unpair") }
        }

        HorizontalDivider()
        Text("2. Allow Health Connect access", style = MaterialTheme.typography.titleMedium)
        when (sdkStatus) {
            HealthConnectClient.SDK_AVAILABLE -> {
                Text("${granted.size} of ${HealthReader.PERMISSIONS.size} data types allowed.")
                Button(
                    enabled = !busy,
                    onClick = { permissionLauncher.launch(HealthReader.PERMISSIONS) },
                ) { Text(if (granted.isEmpty()) "Allow access" else "Change access") }
            }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                Text("Health Connect needs to be installed or updated.")
                Button(onClick = {
                    context.startActivity(
                        Intent(
                            Intent.ACTION_VIEW,
                            Uri.parse("market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding"),
                        ),
                    )
                }) { Text("Open Play Store") }
            }
            else -> Text("Health Connect isn't supported on this phone.")
        }

        HorizontalDivider()
        Text("3. Sync", style = MaterialTheme.typography.titleMedium)
        val canSync = !busy && token != null && granted.isNotEmpty()
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = canSync, onClick = { sync(24) }) { Text("Last 24 hours") }
            OutlinedButton(enabled = canSync, onClick = { sync(24 * 7) }) { Text("Last 7 days") }
        }

        if (busy) Text("Working…")
        if (status.isNotEmpty()) Text(status)
    }
}
