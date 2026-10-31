package com.guzelradio.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.guzelradio.MainActivity
import com.guzelradio.R
import com.guzelradio.service.RadioPlaybackService

/**
 * Home-screen widget: shows the current station and play/pause + skip buttons.
 * Playback itself stays in [RadioPlaybackService], which pushes its state here
 * through [update] and persists it so the widget survives process death.
 */
class RadioWidgetProvider : AppWidgetProvider() {

    enum class Status { PLAYING, BUFFERING, PAUSED }

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val status = runCatching { Status.valueOf(prefs.getString(KEY_STATUS, null) ?: "") }
            .getOrDefault(Status.PAUSED)
        val name = prefs.getString(KEY_STATION_NAME, null)
        appWidgetIds.forEach { manager.updateAppWidget(it, buildViews(context, name, status)) }
    }

    companion object {
        private const val PREFS = "radio_widget"
        private const val KEY_STATUS = "status"
        private const val KEY_STATION_NAME = "station_name"

        /** Persists the latest playback state and refreshes every placed widget. */
        fun update(context: Context, stationName: String?, status: Status) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_STATUS, status.name)
                .putString(KEY_STATION_NAME, stationName)
                .apply()

            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, RadioWidgetProvider::class.java))
            if (ids.isEmpty()) return
            val views = buildViews(context, stationName, status)
            ids.forEach { manager.updateAppWidget(it, views) }
        }

        private fun buildViews(context: Context, stationName: String?, status: Status): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_radio)

            views.setTextViewText(R.id.widget_station, stationName ?: context.getString(R.string.app_name))
            views.setTextViewText(
                R.id.widget_status,
                context.getString(
                    when {
                        stationName == null -> R.string.widget_tap_to_play
                        status == Status.PLAYING -> R.string.widget_playing
                        status == Status.BUFFERING -> R.string.widget_buffering
                        else -> R.string.widget_paused
                    }
                )
            )

            val playing = status != Status.PAUSED
            views.setImageViewResource(
                R.id.widget_play_pause,
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
            )

            val open = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Nothing played yet means nothing to resume, so play opens the app instead
            views.setOnClickPendingIntent(
                R.id.widget_play_pause,
                when {
                    stationName == null -> open
                    playing -> serviceIntent(context, RadioPlaybackService.ACTION_PAUSE)
                    else -> serviceIntent(context, RadioPlaybackService.ACTION_PLAY)
                }
            )
            views.setOnClickPendingIntent(R.id.widget_prev, serviceIntent(context, RadioPlaybackService.ACTION_PREVIOUS))
            views.setOnClickPendingIntent(R.id.widget_next, serviceIntent(context, RadioPlaybackService.ACTION_NEXT))

            views.setOnClickPendingIntent(R.id.widget_station, open)
            views.setOnClickPendingIntent(R.id.widget_status, open)
            return views
        }

        // Starting the service is allowed here: the PendingIntent fires from a
        // user tap on the widget, and the service promotes itself once audio plays.
        private fun serviceIntent(context: Context, action: String): PendingIntent {
            val intent = Intent(context, RadioPlaybackService::class.java).setAction(action)
            return PendingIntent.getService(
                context, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
