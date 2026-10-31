package com.guzelradio.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import android.util.Log
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class RadioRepository private constructor(context: Context) {

    companion object {
        private const val TAG = "RadioRepository"
        // Our caching proxy first (it keeps serving the last list during Radio Browser outages),
        // then Radio Browser's own mirrors.
        private const val RADIO_BROWSER_BASE = "https://radio.recepguzel.com/api/rb/json/"
        private const val CACHE_PATH_PREFIX = "/api/rb/json/"
        private val RADIO_BROWSER_HOSTS = listOf(
            "de1.api.radio-browser.info",
            "de2.api.radio-browser.info",
            "fi1.api.radio-browser.info"
        )
        private const val HEALTH_BASE = "https://radio.recepguzel.com/"
        private const val PREFS_NAME = "guzel_radio_prefs"
        private const val PREFS_KEY_FAVORITES = "favorites"
        private const val PREFS_KEY_FAVORITES_CACHE = "favorites_cache"
        private const val PREFS_KEY_COUNTRY = "selected_country"

        @Volatile
        private var INSTANCE: RadioRepository? = null

        fun getInstance(context: Context): RadioRepository =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: RadioRepository(context.applicationContext).also { INSTANCE = it }
            }
    }

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Retries a failed list request (5xx, network error) on each Radio Browser mirror in turn. */
    private val mirrorFailover = Interceptor { chain ->
        val request = chain.request()
        var lastError: IOException? = null
        var lastResponse: Response? = null
        val attempts = listOf(request.url()) + RADIO_BROWSER_HOSTS.map { host ->
            request.url().newBuilder()
                .host(host)
                .encodedPath("/json/" + request.url().encodedPath().removePrefix(CACHE_PATH_PREFIX))
                .build()
        }
        for (url in attempts) {
            lastResponse?.close()
            lastResponse = null
            try {
                val response = chain.proceed(request.newBuilder().url(url).build())
                if (response.code() < 500) return@Interceptor response
                lastResponse = response
            } catch (e: IOException) {
                lastError = e
            }
        }
        lastResponse ?: throw (lastError ?: IOException("No station server available"))
    }

    private val radioBrowserClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .addInterceptor(mirrorFailover)
        .build()

    private val radioBrowserRetrofit: Retrofit = Retrofit.Builder()
        .baseUrl(RADIO_BROWSER_BASE)
        .client(radioBrowserClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    private val healthRetrofit: Retrofit = Retrofit.Builder()
        .baseUrl(HEALTH_BASE)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    private val radioBrowserApi: RadioBrowserApi = radioBrowserRetrofit.create(RadioBrowserApi::class.java)
    private val healthApi: HealthApi = healthRetrofit.create(HealthApi::class.java)

    suspend fun fetchStations(category: Category, offset: Int = 0, query: String? = null, country: String = "Türkiye"): List<Station> {
        return try {
            val stations: List<Station> = when {
                !query.isNullOrBlank() -> radioBrowserApi.searchStationsByName(name = query, country = country, offset = offset)
                category == Category.FAVORITES -> fetchFavoriteStations()
                category == Category.ALL -> radioBrowserApi.getStationsByCountry(country = country, offset = offset)
                category == Category.MOST_PLAYED -> fetchMostPlayed()
                else -> {
                    val tag = category.tag ?: return emptyList()
                    radioBrowserApi.searchStations(tag = tag, country = country, offset = offset)
                }
            }
            if (stations.isNotEmpty()) mergeHealth(stations) else stations
        } catch (e: Exception) {
            Log.e(TAG, "fetchStations failed for $category", e)
            emptyList()
        }
    }

    private suspend fun fetchMostPlayed(): List<Station> {
        return try {
            val top = healthApi.getTopStations(limit = 50)
            val uuids = top.map { it.uuid }.takeIf { it.isNotEmpty() } ?: return emptyList()
            radioBrowserApi.getStationsByUuid(uuids = uuids.joinToString(","))
        } catch (e: Exception) {
            Log.e(TAG, "fetchMostPlayed failed", e)
            emptyList()
        }
    }

    private suspend fun mergeHealth(stations: List<Station>): List<Station> {
        return try {
            val uuids = stations.joinToString(",") { it.uuid }
            val healthMap = healthApi.getHealth(uuids = uuids)
            stations.forEach { it.healthScore = healthMap[it.uuid]?.successRate }
            stations
        } catch (e: Exception) {
            Log.w(TAG, "Health merge failed: ${e.message}")
            stations
        }
    }

    suspend fun reportSuccess(uuid: String) {
        try { healthApi.reportSuccess(uuid) } catch (e: Exception) { Log.w(TAG, "reportSuccess failed: ${e.message}") }
    }

    suspend fun reportFailure(uuid: String) {
        try { healthApi.reportFailure(uuid) } catch (e: Exception) { Log.w(TAG, "reportFailure failed: ${e.message}") }
    }

    fun getFavorites(): Set<String> = prefs.getStringSet(PREFS_KEY_FAVORITES, emptySet()) ?: emptySet()

    fun toggleFavorite(uuid: String) {
        val current = getFavorites().toMutableSet()
        if (current.contains(uuid)) current.remove(uuid) else current.add(uuid)
        prefs.edit().putStringSet(PREFS_KEY_FAVORITES, current).apply()
    }

    fun isFavorite(uuid: String): Boolean = getFavorites().contains(uuid)

    suspend fun fetchFavoriteStations(): List<Station> {
        val uuids = getFavorites()
        if (uuids.isEmpty()) return emptyList()
        return try {
            val stations = radioBrowserApi.getStationsByUuid(uuids = uuids.joinToString(","))
            prefs.edit().putString(PREFS_KEY_FAVORITES_CACHE, Gson().toJson(stations)).apply()
            mergeHealth(stations)
        } catch (e: Exception) {
            Log.e(TAG, "fetchFavoriteStations failed", e)
            emptyList()
        }
    }

    /** Last favorites fetched from the network, for use offline (e.g. the favorites widget). */
    fun getCachedFavoriteStations(): List<Station> {
        val json = prefs.getString(PREFS_KEY_FAVORITES_CACHE, null) ?: return emptyList()
        val favorites = getFavorites()
        return runCatching { Gson().fromJson(json, Array<Station>::class.java).toList() }
            .getOrDefault(emptyList())
            .filter { it.uuid in favorites }
    }

    fun getSelectedCountry(): String = prefs.getString(PREFS_KEY_COUNTRY, "Türkiye") ?: "Türkiye"
    fun setSelectedCountry(countryName: String) = prefs.edit().putString(PREFS_KEY_COUNTRY, countryName).apply()
    fun isFirstRun(): Boolean = !prefs.contains(PREFS_KEY_COUNTRY)
    suspend fun fetchCountries(): List<Country> = try { radioBrowserApi.getCountries() } catch (e: Exception) { emptyList() }
}
