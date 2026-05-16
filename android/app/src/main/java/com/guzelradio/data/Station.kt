package com.guzelradio.data

import com.google.gson.annotations.SerializedName

data class Station(
    @SerializedName("stationuuid") val uuid: String,
    @SerializedName("name") val name: String,
    @SerializedName("url_resolved") val streamUrl: String,
    @SerializedName("favicon") val favicon: String?,
    @SerializedName("codec") val codec: String?,
    @SerializedName("bitrate") val bitrate: Int?,
    @SerializedName("country") val country: String?,
    @SerializedName("tags") val tags: String?,
    // merged from health API — not from RadioBrowser
    var healthScore: Float? = null
) {
    val displayCodec: String
        get() {
            val c = codec?.uppercase()?.takeIf { it.isNotBlank() } ?: "?"
            val b = bitrate?.takeIf { it > 0 }
            return if (b != null) "$c • ${b}kbps" else c
        }

    val initials: String
        get() = name.trim()
            .split(Regex("\\s+"))
            .take(2)
            .mapNotNull { it.firstOrNull()?.uppercaseChar() }
            .joinToString("")
            .ifEmpty { "?" }
}

data class HealthResponse(
    @SerializedName("uuid") val uuid: String,
    @SerializedName("success_rate") val successRate: Float?,
    @SerializedName("total_checks") val totalChecks: Int?
)

data class TopStationsResponse(
    @SerializedName("stations") val stations: List<TopStationEntry>?
)

data class TopStationEntry(
    @SerializedName("uuid") val uuid: String,
    @SerializedName("play_count") val playCount: Int?
)

enum class Category(val label: String, val tag: String?) {
    ALL("All", null),
    MOST_PLAYED("Most Played", null),
    POP("Pop", "pop"),
    CLASSICAL("Classical", "classical"),
    NEWS("News", "news"),
    ARABESK("Arabesk", "arabesk"),
    INTERNATIONAL("International", "international"),
    BROADCAST("Broadcast", "broadcast"),
    COMEDY("Comedy", "comedy");

    companion object {
        fun all(): List<Category> = values().toList()
    }
}
