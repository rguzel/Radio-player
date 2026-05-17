package com.guzelradio.data

import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface HealthApi {
    @GET("api/health")
    suspend fun getHealth(
        @Query("uuids") uuids: String
    ): Map<String, HealthResponse>

    @GET("api/health/top")
    suspend fun getTopStations(
        @Query("limit") limit: Int = 50
    ): List<TopStationEntry>

    @POST("api/health/{uuid}/success")
    suspend fun reportSuccess(
        @Path("uuid") uuid: String
    ): retrofit2.Response<Unit>

    @POST("api/health/{uuid}/failure")
    suspend fun reportFailure(
        @Path("uuid") uuid: String
    ): retrofit2.Response<Unit>
}
