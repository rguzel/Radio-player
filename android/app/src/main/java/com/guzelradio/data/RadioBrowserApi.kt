package com.guzelradio.data

import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface RadioBrowserApi {

    /**
     * All stations in Türkiye (no tag filter)
     */
    @GET("stations/bycountry/T%C3%BCrkiye")
    suspend fun getStationsByCountry(
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
        @Query("hidebroken") hideBroken: Boolean = true,
        @Query("order") order: String = "clickcount",
        @Query("reverse") reverse: Boolean = true
    ): List<Station>

    /**
     * Stations filtered by tag (category)
     */
    @GET("stations/search")
    suspend fun searchStations(
        @Query("tagList") tag: String,
        @Query("country") country: String = "Türkiye",
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
        @Query("hidebroken") hideBroken: Boolean = true,
        @Query("order") order: String = "clickcount",
        @Query("reverse") reverse: Boolean = true
    ): List<Station>

    /**
     * Stations filtered by name
     */
    @GET("stations/search")
    suspend fun searchStationsByName(
        @Query("name") name: String,
        @Query("country") country: String = "Türkiye",
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
        @Query("hidebroken") hideBroken: Boolean = true,
        @Query("order") order: String = "clickcount",
        @Query("reverse") reverse: Boolean = true
    ): List<Station>

    /**
     * Fetch stations by a list of UUIDs (used for Most Played)
     */
    @GET("stations/byuuid")
    suspend fun getStationsByUuid(
        @Query("uuids") uuids: String
    ): List<Station>
}
