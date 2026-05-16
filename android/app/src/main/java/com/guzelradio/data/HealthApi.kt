package com.guzelradio.data

import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface HealthApi {

    /**
     * Batch health check for multiple station UUIDs.
     * Returns a list of HealthResponse, one per UUID.
     */
    @GET("api/health")
    suspend fun getHealth(
        @Query("uuids") uuids: String
    ): List<HealthResponse>

    /**
     * Get top stations by play count from our health API.
     */
    @GET("api/health/top")
    suspend fun getTopStations(
        @Query("limit") limit: Int = 50
    ): TopStationsResponse

    /**
     * Report a successful play for a station.
     */
    @POST("api/health/{uuid}/success")
    suspend fun reportSuccess(
        @Path("uuid") uuid: String
    ): retrofit2.Response<Unit>

    /**
     * Report a failed play for a station.
     */
    @POST("api/health/{uuid}/failure")
    suspend fun reportFailure(
        @Path("uuid") uuid: String
    ): retrofit2.Response<Unit>
}
