package com.guzelradio.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class RadioRepository private constructor(context: Context) {

    companion object {
        private const val TAG = "RadioRepository"
        private const val RADIO_BROWSER_BASE = "https://de1.api.radio-browser.info/json/"
        private const val HEALTH_BASE = "https://radio.recepguzel.com/"
        private const val PREFS_NAME = "guzel_radio_prefs"
        private const val PREFS_KEY_FAVORITES = "favorites"
        private const val PREFS_KEY_COUNTRY = "selected_country"

        @Volatile
        private var INSTANCE: RadioRepository? = null

        fun getInstance(context: Context): RadioRepository =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: RadioRepository(context.applicationContext).also { INSTANCE = it }
            }
    }

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val radioBrowserRetrofit: Retrofit = Retrofit.Builder()
        .baseUrl(RADIO_BROWSER_BASE)
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
            mergeHealth(stations)
        } catch (e: Exception) {
            Log.e(TAG, "fetchFavoriteStations failed", e)
            emptyList()
        }
    }

    fun getSelectedCountry(): String = prefs.getString(PREFS_KEY_COUNTRY, "Türkiye") ?: "Türkiye"
    fun setSelectedCountry(countryName: String) = prefs.edit().putString(PREFS_KEY_COUNTRY, countryName).apply()
    fun isFirstRun(): Boolean = !prefs.contains(PREFS_KEY_COUNTRY)
    suspend fun fetchCountries(): List<Country> = try { radioBrowserApi.getCountries() } catch (e: Exception) { emptyList() }
}
