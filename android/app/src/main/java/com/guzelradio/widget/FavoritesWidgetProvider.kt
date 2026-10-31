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

/** Home-screen widget: a grid of favorite stations, each one tap from playing. */
class FavoritesWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { manager.updateAppWidget(it, buildViews(context)) }
        @Suppress("DEPRECATION")
        manager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.favorites_grid)
    }

    companion object {
        /** Reloads the grid in every placed widget, e.g. after a favorite changes. */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, FavoritesWidgetProvider::class.java))
            if (ids.isEmpty()) return
            @Suppress("DEPRECATION")
            manager.notifyAppWidgetViewDataChanged(ids, R.id.favorites_grid)
        }

        private fun buildViews(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_favorites)

            @Suppress("DEPRECATION")
            views.setRemoteAdapter(R.id.favorites_grid, Intent(context, FavoritesWidgetService::class.java))
            views.setEmptyView(R.id.favorites_grid, R.id.favorites_empty)

            // Each grid item fills in its station's extras, hence FLAG_MUTABLE
            views.setPendingIntentTemplate(
                R.id.favorites_grid,
                PendingIntent.getService(
                    context, 0, Intent(context, RadioPlaybackService::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                )
            )

            val open = PendingIntent.getActivity(
                context, 1, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.favorites_title, open)
            views.setOnClickPendingIntent(R.id.favorites_empty, open)
            return views
        }
    }
}
