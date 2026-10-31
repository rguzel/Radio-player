package com.guzelradio.widget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import androidx.core.graphics.drawable.toBitmap
import coil.executeBlocking
import coil.imageLoader
import coil.request.ImageRequest
import com.guzelradio.R
import com.guzelradio.data.RadioRepository
import com.guzelradio.data.Station
import com.guzelradio.service.RadioPlaybackService
import kotlinx.coroutines.runBlocking

/** Supplies the favorites widget's grid; the factory's callbacks run off the main thread. */
class FavoritesWidgetService : RemoteViewsService() {

    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

    private class Factory(private val context: Context) : RemoteViewsFactory {
        private var stations: List<Station> = emptyList()

        override fun onDataSetChanged() {
            val repository = RadioRepository.getInstance(context)
            val fetched = runBlocking { repository.fetchFavoriteStations() }
            stations = fetched.ifEmpty { repository.getCachedFavoriteStations() }
                .sortedBy { it.name.lowercase() }
        }

        override fun getViewAt(position: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_favorites_item)
            val station = stations.getOrNull(position) ?: return views

            views.setTextViewText(R.id.favorite_name, station.name)
            // The layout's placeholder stays if there's no logo or it can't be loaded
            loadLogo(station)?.let { views.setImageViewBitmap(R.id.favorite_logo, it) }
            views.setOnClickFillInIntent(
                R.id.favorite_item,
                Intent()
                    .putExtra(RadioPlaybackService.EXTRA_STREAM_URL, station.streamUrl)
                    .putExtra(RadioPlaybackService.EXTRA_STATION_NAME, station.name)
                    .putExtra(RadioPlaybackService.EXTRA_STATION_UUID, station.uuid)
                    .putExtra(RadioPlaybackService.EXTRA_FAVICON_URL, station.favicon)
            )
            return views
        }

        private fun loadLogo(station: Station) = station.favicon?.takeIf { it.isNotBlank() }?.let { url ->
            val request = ImageRequest.Builder(context)
                .data(url)
                .size(LOGO_SIZE_PX)
                .allowHardware(false)
                .build()
            context.imageLoader.executeBlocking(request).drawable?.toBitmap(LOGO_SIZE_PX, LOGO_SIZE_PX)
        }

        override fun getCount() = stations.size
        override fun getItemId(position: Int) = stations[position].uuid.hashCode().toLong()
        override fun hasStableIds() = true
        override fun getViewTypeCount() = 1
        override fun getLoadingView(): RemoteViews? = null
        override fun onCreate() = Unit
        override fun onDestroy() = Unit
    }

    private companion object {
        const val LOGO_SIZE_PX = 144
    }
}
