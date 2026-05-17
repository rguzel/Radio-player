package com.guzelradio.data

import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface RadioBrowserApi {
    @GET("stations/bycountry/{country}")
    suspend fun getStationsByCountry(
        @Path("country") country: String,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
        @Query("hidebroken") hideBroken: Boolean = true,
        @Query("order") order: String = "clickcount",
        @Query("reverse") reverse: Boolean = true
    ): List<Station>

    @GET("stations/search")
    suspend fun searchStations(
        @Query("tagList") tag: String,
        @Query("country") country: String,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
        @Query("hidebroken") hideBroken: Boolean = true,
        @Query("order") order: String = "clickcount",
        @Query("reverse") reverse: Boolean = true
    ): List<Station>

    @GET("stations/search")
    suspend fun searchStationsByName(
        @Query("name") name: String,
        @Query("country") country: String,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
        @Query("hidebroken") hideBroken: Boolean = true,
        @Query("order") order: String = "clickcount",
        @Query("reverse") reverse: Boolean = true
    ): List<Station>

    @GET("countries")
    suspend fun getCountries(
        @Query("order") order: String = "name"
    ): List<Country>

    @GET("stations/byuuid")
    suspend fun getStationsByUuid(
        @Query("uuids") uuids: String
    ): List<Station>
}
