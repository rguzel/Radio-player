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
    @SerializedName("successes") val successes: Int?,
    @SerializedName("failures") val failures: Int?
) {
    val successRate: Float?
        get() {
            val s = successes ?: 0
            val f = failures ?: 0
            val total = s + f
            return if (total > 0) s.toFloat() / total else null
        }
}

data class TopStationEntry(
    @SerializedName("stationuuid") val uuid: String,
    @SerializedName("successes") val successes: Int?,
    @SerializedName("failures") val failures: Int?
)

data class Country(
    @SerializedName("name") val name: String,
    @SerializedName("iso_3166_1") val code: String,
    @SerializedName("stationcount") val stationCount: Int
)

enum class Category(val label: String, val tag: String?) {
    ALL("All", null),
    FAVORITES("Favorites", null),
    MOST_PLAYED("Most Played", null),
    POP("Pop", "pop"),
    CLASSICAL("Classical", "classical"),
    NEWS("News", "news"),
    ARABESK("Arabesk", "arabesk"),
    INTERNATIONAL("International", "international"),
    BROADCAST("Broadcast", "broadcast"),
    COMEDY("Comedy", "comedy");
}
