package com.kincare.sync

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.reflect.KClass

/**
 * Reads Health Connect and serializes each record in the shape the backend's
 * adapter expects (backend/src/integrations/healthConnect.ts). Record types the
 * user didn't allow are skipped rather than failing the whole sync.
 */
class HealthReader(private val client: HealthConnectClient) {

    companion object {
        /** Every type we read. Must match the READ_* permissions in AndroidManifest.xml. */
        val RECORD_TYPES: List<KClass<out Record>> = listOf(
            HeartRateRecord::class,
            RestingHeartRateRecord::class,
            BloodPressureRecord::class,
            OxygenSaturationRecord::class,
            BodyTemperatureRecord::class,
            RespiratoryRateRecord::class,
            BloodGlucoseRecord::class,
            WeightRecord::class,
            StepsRecord::class,
            DistanceRecord::class,
            ActiveCaloriesBurnedRecord::class,
            FloorsClimbedRecord::class,
            ExerciseSessionRecord::class,
            SleepSessionRecord::class,
        )

        val PERMISSIONS: Set<String> = RECORD_TYPES.map { HealthPermission.getReadPermission(it) }.toSet()
    }

    suspend fun read(start: Instant, end: Instant, granted: Set<String>): List<JSONObject> {
        val out = mutableListOf<JSONObject>()

        collect(HeartRateRecord::class, start, end, granted, out) { r ->
            // One record holds many samples; the backend wants one entry per sample.
            r.samples.mapIndexed { i, s ->
                point(r, "HeartRate", s.time, idSuffix = ":$i").put("beatsPerMinute", s.beatsPerMinute)
            }
        }
        collect(RestingHeartRateRecord::class, start, end, granted, out) { r ->
            listOf(point(r, "RestingHeartRate", r.time).put("beatsPerMinute", r.beatsPerMinute))
        }
        collect(BloodPressureRecord::class, start, end, granted, out) { r ->
            listOf(
                point(r, "BloodPressure", r.time)
                    .put("systolic", r.systolic.inMillimetersOfMercury)
                    .put("diastolic", r.diastolic.inMillimetersOfMercury),
            )
        }
        collect(OxygenSaturationRecord::class, start, end, granted, out) { r ->
            listOf(point(r, "OxygenSaturation", r.time).put("percentage", r.percentage.value))
        }
        collect(BodyTemperatureRecord::class, start, end, granted, out) { r ->
            listOf(point(r, "BodyTemperature", r.time).put("temperature", r.temperature.inCelsius).put("unit", "celsius"))
        }
        collect(RespiratoryRateRecord::class, start, end, granted, out) { r ->
            listOf(point(r, "RespiratoryRate", r.time).put("rate", r.rate))
        }
        collect(BloodGlucoseRecord::class, start, end, granted, out) { r ->
            listOf(point(r, "BloodGlucose", r.time).put("level", r.level.inMilligramsPerDeciliter).put("unit", "mg/dL"))
        }
        collect(WeightRecord::class, start, end, granted, out) { r ->
            listOf(point(r, "Weight", r.time).put("weightKg", r.weight.inKilograms))
        }
        collect(StepsRecord::class, start, end, granted, out) { r ->
            listOf(span(r, "Steps", r.startTime, r.endTime).put("count", r.count))
        }
        collect(DistanceRecord::class, start, end, granted, out) { r ->
            listOf(span(r, "Distance", r.startTime, r.endTime).put("distanceMeters", r.distance.inMeters))
        }
        collect(ActiveCaloriesBurnedRecord::class, start, end, granted, out) { r ->
            listOf(span(r, "ActiveCaloriesBurned", r.startTime, r.endTime).put("energyKcal", r.energy.inKilocalories))
        }
        collect(FloorsClimbedRecord::class, start, end, granted, out) { r ->
            listOf(span(r, "FloorsClimbed", r.startTime, r.endTime).put("floors", r.floors))
        }
        collect(ExerciseSessionRecord::class, start, end, granted, out) { r ->
            listOf(span(r, "ExerciseSession", r.startTime, r.endTime))
        }
        collect(SleepSessionRecord::class, start, end, granted, out) { r ->
            // Stage types go as Health Connect's int constants; the backend maps them.
            val stages = JSONArray(
                r.stages.map {
                    JSONObject()
                        .put("stage", it.stage)
                        .put("startTime", it.startTime.toString())
                        .put("endTime", it.endTime.toString())
                },
            )
            listOf(span(r, "SleepSession", r.startTime, r.endTime).put("stages", stages))
        }

        return out
    }

    private suspend fun <T : Record> collect(
        type: KClass<T>,
        start: Instant,
        end: Instant,
        granted: Set<String>,
        out: MutableList<JSONObject>,
        toJson: (T) -> List<JSONObject>,
    ) {
        if (HealthPermission.getReadPermission(type) !in granted) return
        var pageToken: String? = null
        do {
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType = type,
                    timeRangeFilter = TimeRangeFilter.between(start, end),
                    pageToken = pageToken,
                ),
            )
            response.records.forEach { out += toJson(it) }
            pageToken = response.pageToken
        } while (pageToken != null)
    }

    /** A record measured at one instant. */
    private fun point(r: Record, recordType: String, time: Instant, idSuffix: String = "") =
        JSONObject()
            .put("id", r.metadata.id + idSuffix)
            .put("recordType", recordType)
            .put("time", time.toString())

    /** A record covering a span of time (steps, sleep, ...). */
    private fun span(r: Record, recordType: String, start: Instant, end: Instant) =
        JSONObject()
            .put("id", r.metadata.id)
            .put("recordType", recordType)
            .put("startTime", start.toString())
            .put("endTime", end.toString())
}
