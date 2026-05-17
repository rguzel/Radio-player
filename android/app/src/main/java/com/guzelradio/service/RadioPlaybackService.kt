package com.guzelradio.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.guzelradio.MainActivity
import com.guzelradio.R
import com.guzelradio.data.Category
import com.guzelradio.data.RadioRepository
import com.guzelradio.data.Station
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class RadioPlaybackService : MediaBrowserServiceCompat() {

    companion object {
        private const val TAG = "RadioPlaybackService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "guzel_radio_playback"

        // Media IDs for Android Auto browsing
        const val ROOT_ID = "ROOT"
        const val CATEGORY_PREFIX = "CATEGORY_"
        const val STATION_PREFIX = "STATION_"

        // Action sent from UI to control playback
        const val ACTION_PLAY = "com.guzelradio.ACTION_PLAY"
        const val ACTION_PAUSE = "com.guzelradio.ACTION_PAUSE"
        const val ACTION_STOP = "com.guzelradio.ACTION_STOP"

        // Custom extras key for passing station data
        const val EXTRA_STREAM_URL = "stream_url"
        const val EXTRA_STATION_NAME = "station_name"
        const val EXTRA_STATION_UUID = "station_uuid"
        const val EXTRA_FAVICON_URL = "favicon_url"
    }

    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var exoPlayer: ExoPlayer
    private lateinit var stateBuilder: PlaybackStateCompat.Builder
    private lateinit var repository: RadioRepository
    private val serviceScope = CoroutineScope(Dispatchers.Main + Job())

    // Cache of station lists per category for Android Auto browsing
    private val categoryStationCache = mutableMapOf<Category, List<Station>>()

    // Currently loaded station
    private var currentStation: Station? = null
    private var currentUuid: String? = null
    private var playStartTime: Long = 0L
    private var playReported = false

    override fun onCreate() {
        super.onCreate()
        repository = RadioRepository.getInstance(this)
        createNotificationChannel()
        initExoPlayer()
        initMediaSession()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Radio Playback",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows currently playing radio station"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    private fun initExoPlayer() {
        exoPlayer = ExoPlayer.Builder(this).build()
        exoPlayer.addListener(object : Player.Listener {
            override fun onMediaMetadataChanged(mediaMetadata: androidx.media3.common.MediaMetadata) {
                // This is called when stream metadata (ICY/RDS) changes
                val title = mediaMetadata.title ?: mediaMetadata.displayTitle
                val artist = mediaMetadata.artist

                val metadataBuilder = MediaMetadataCompat.Builder()
                
                // Keep station info if track info is missing
                val displayTitle = if (!title.isNullOrBlank()) title.toString() else currentStation?.name ?: "Unknown"
                val displayArtist = if (!artist.isNullOrBlank()) artist.toString() else "Live Radio"

                val placeholderUri = "android.resource://${packageName}/drawable/ic_placeholder_radio"
                val iconUri = currentStation?.favicon?.takeIf { it.isNotBlank() } ?: placeholderUri

                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, currentUuid ?: "")
                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_TITLE, displayTitle)
                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, displayArtist)
                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Guzel Radio")
                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, displayTitle)
                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, displayArtist)
                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, iconUri)
                metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, iconUri)

                mediaSession.setMetadata(metadataBuilder.build())
                updateNotification()
            }

            override fun onPlaybackStateChanged(state: Int) {
                updatePlaybackState()
                if (state == Player.STATE_READY && exoPlayer.playWhenReady) {
                    if (!playReported) {
                        playReported = true
                        currentUuid?.let { uuid ->
                            serviceScope.launch(Dispatchers.IO) {
                                repository.reportSuccess(uuid)
                            }
                        }
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updatePlaybackState()
                updateNotification()
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                Log.e(TAG, "ExoPlayer error", error)
                playReported = false
                currentUuid?.let { uuid ->
                    serviceScope.launch(Dispatchers.IO) {
                        repository.reportFailure(uuid)
                    }
                }
                updatePlaybackState()
            }
        })
    }

    private fun initMediaSession() {
        val sessionActivityIntent = Intent(this, MainActivity::class.java)
        val sessionActivityPendingIntent = PendingIntent.getActivity(
            this, 0, sessionActivityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        mediaSession = MediaSessionCompat(this, TAG).apply {
            setSessionActivity(sessionActivityPendingIntent)
            isActive = true
            setCallback(MediaSessionCallback())
        }

        sessionToken = mediaSession.sessionToken

        stateBuilder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_STOP or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            )

        mediaSession.setPlaybackState(
            stateBuilder.setState(
                PlaybackStateCompat.STATE_NONE, 0, 1.0f
            ).build()
        )
    }

    private fun updatePlaybackState() {
        val state = when {
            exoPlayer.playbackState == Player.STATE_BUFFERING -> PlaybackStateCompat.STATE_BUFFERING
            exoPlayer.isPlaying -> PlaybackStateCompat.STATE_PLAYING
            exoPlayer.playbackState == Player.STATE_ENDED -> PlaybackStateCompat.STATE_STOPPED
            exoPlayer.playbackState == Player.STATE_IDLE -> PlaybackStateCompat.STATE_STOPPED
            else -> PlaybackStateCompat.STATE_PAUSED
        }
        mediaSession.setPlaybackState(
            stateBuilder.setState(state, 0, 1.0f).build()
        )
    }

    private fun updateNotification() {
        val notification = buildNotification()
        if (exoPlayer.isPlaying || exoPlayer.playbackState == Player.STATE_BUFFERING) {
            startForeground(NOTIFICATION_ID, notification)
        } else {
            stopForeground(STOP_FOREGROUND_DETACH)
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val playPauseAction = if (exoPlayer.isPlaying) {
            NotificationCompat.Action(
                android.R.drawable.ic_media_pause,
                "Pause",
                buildActionPendingIntent(ACTION_PAUSE)
            )
        } else {
            NotificationCompat.Action(
                android.R.drawable.ic_media_play,
                "Play",
                buildActionPendingIntent(ACTION_PLAY)
            )
        }

        val stopAction = NotificationCompat.Action(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Stop",
            buildActionPendingIntent(ACTION_STOP)
        )

        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stationName = currentStation?.name ?: "Guzel Radio"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(stationName)
            .setContentText(if (exoPlayer.isPlaying) "Playing" else if (exoPlayer.playbackState == Player.STATE_BUFFERING) "Buffering…" else "Paused")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(playPauseAction)
            .addAction(stopAction)
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1)
            )
            .setOngoing(exoPlayer.isPlaying)
            .build()
    }

    private fun buildActionPendingIntent(action: String): PendingIntent {
        val intent = Intent(this, RadioPlaybackService::class.java).apply {
            this.action = action
        }
        return PendingIntent.getService(
            this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> exoPlayer.play()
            ACTION_PAUSE -> exoPlayer.pause()
            ACTION_STOP -> {
                exoPlayer.stop()
                stopSelf()
            }
            else -> {
                // Play a new station if stream URL was passed
                val streamUrl = intent?.getStringExtra(EXTRA_STREAM_URL)
                val stationName = intent?.getStringExtra(EXTRA_STATION_NAME)
                val uuid = intent?.getStringExtra(EXTRA_STATION_UUID)
                val faviconUrl = intent?.getStringExtra(EXTRA_FAVICON_URL)
                if (streamUrl != null) {
                    playStream(streamUrl, stationName, uuid, faviconUrl)
                }
            }
        }
        return START_STICKY
    }

    fun playStation(station: Station) {
        playStream(station.streamUrl, station.name, station.uuid, station.favicon)
    }

    private fun playStream(
        url: String,
        name: String?,
        uuid: String?,
        faviconUrl: String?
    ) {
        currentUuid = uuid
        playReported = false
        
        // Store current station info for metadata fallbacks
        currentStation = name?.let { n -> 
            Station(
                uuid = uuid ?: "",
                name = n,
                favicon = faviconUrl ?: "",
                streamUrl = url,
                codec = null,
                bitrate = null,
                country = null,
                tags = null
            )
        }

        val placeholderUri = "android.resource://${packageName}/drawable/ic_placeholder_radio"
        val iconUri = if (!faviconUrl.isNullOrBlank()) faviconUrl else placeholderUri

        // Update metadata with station info as primary
        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, uuid ?: "")
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, name ?: "Guzel Radio")
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Live Radio")
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Guzel Radio")
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, name ?: "Guzel Radio")
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, "Live Radio")
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, iconUri)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, iconUri)
            .build()
        mediaSession.setMetadata(metadata)

        exoPlayer.stop()
        exoPlayer.clearMediaItems()
        exoPlayer.setMediaItem(MediaItem.fromUri(Uri.parse(url)))
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true

        updateNotification()
    }

    // ── MediaBrowserServiceCompat ─────────────────────────────────────────────

    /**
     * Called by Android Auto / other MediaBrowser clients to get the root.
     * Return a browsable root for Auto; null for untrusted callers.
     */
    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?
    ): BrowserRoot {
        // Accept all clients (phone app + Auto). For stricter security, check clientPackageName.
        return BrowserRoot(ROOT_ID, null)
    }

    /**
     * Called by Android Auto to load children of a media node.
     */
    override fun onLoadChildren(
        parentId: String,
        result: Result<List<MediaBrowserCompat.MediaItem>>
    ) {
        when {
            parentId == ROOT_ID -> {
                // Return list of categories
                val categories = Category.entries.map { category ->
                    val desc = MediaDescriptionCompat.Builder()
                        .setMediaId("$CATEGORY_PREFIX${category.name}")
                        .setTitle(category.label)
                        .build()
                    MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE)
                }
                result.sendResult(categories)
            }
            parentId.startsWith(CATEGORY_PREFIX) -> {
                val categoryName = parentId.removePrefix(CATEGORY_PREFIX)
                val category = runCatching {
                    Category.valueOf(categoryName)
                }.getOrNull()

                if (category == null) {
                    result.sendResult(emptyList())
                    return
                }

                result.detach()
                serviceScope.launch {
                    val stations = repository.fetchStations(category)
                    categoryStationCache[category] = stations
                    
                    val placeholderUri = "android.resource://${packageName}/drawable/ic_placeholder_radio"
                    
                    val items = stations.map { station ->
                        val iconUri = station.favicon?.takeIf { it.isNotBlank() } ?: placeholderUri
                        val desc = MediaDescriptionCompat.Builder()
                            .setMediaId("$STATION_PREFIX${station.uuid}")
                            .setTitle(station.name)
                            .setSubtitle(station.displayCodec)
                            .setMediaUri(Uri.parse(station.streamUrl))
                            .setIconUri(Uri.parse(iconUri))
                            .build()
                        MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)
                    }
                    result.sendResult(items)
                }
            }
            else -> result.sendResult(emptyList())
        }
    }

    // ── MediaSession Callback ─────────────────────────────────────────────────

    private inner class MediaSessionCallback : MediaSessionCompat.Callback() {

        override fun onPlay() {
            exoPlayer.play()
            updateNotification()
        }

        override fun onPause() {
            exoPlayer.pause()
            updateNotification()
        }

        override fun onStop() {
            exoPlayer.stop()
            stopForeground(STOP_FOREGROUND_REMOVE)
            mediaSession.isActive = false
            stopSelf()
        }

        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
            if (mediaId == null) return
            if (mediaId.startsWith(STATION_PREFIX)) {
                val uuid = mediaId.removePrefix(STATION_PREFIX)
                // Find station in cache
                val station = categoryStationCache.values.flatten().firstOrNull { it.uuid == uuid }
                if (station != null) {
                    playStation(station)
                }
            }
        }

        override fun onCustomAction(action: String?, extras: Bundle?) {
            when (action) {
                ACTION_PLAY -> exoPlayer.play()
                ACTION_PAUSE -> exoPlayer.pause()
            }
        }

        override fun onSkipToNext() {
            skipToStation(true)
        }

        override fun onSkipToPrevious() {
            skipToStation(false)
        }

        private fun skipToStation(forward: Boolean) {
            serviceScope.launch {
                val favorites = repository.fetchFavoriteStations()
                if (favorites.isEmpty()) return@launch

                val currentIndex = favorites.indexOfFirst { it.uuid == currentUuid }
                val nextIndex = if (currentIndex == -1) {
                    0
                } else {
                    if (forward) {
                        (currentIndex + 1) % favorites.size
                    } else {
                        (currentIndex - 1 + favorites.size) % favorites.size
                    }
                }
                playStation(favorites[nextIndex])
            }
        }

        override fun onSeekTo(pos: Long) {
            // Live streams don't support seeking — ignore
        }
    }

    override fun onDestroy() {
        mediaSession.isActive = false
        mediaSession.release()
        exoPlayer.release()
        super.onDestroy()
    }
}
