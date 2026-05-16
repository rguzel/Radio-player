package com.guzelradio.viewmodel

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.guzelradio.data.Category
import com.guzelradio.data.RadioRepository
import com.guzelradio.data.Station
import com.guzelradio.service.RadioPlaybackService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class StationViewModel(application: Application) : AndroidViewModel(application) {

    companion object {
        private const val TAG = "StationViewModel"
    }

    private val repository = RadioRepository.getInstance(application)

    // ── UI State ──────────────────────────────────────────────────────────────

    private val _stations = MutableStateFlow<List<Station>>(emptyList())
    val stations: StateFlow<List<Station>> = _stations.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _selectedCategory = MutableStateFlow(Category.ALL)
    val selectedCategory: StateFlow<Category> = _selectedCategory.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _currentStation = MutableStateFlow<Station?>(null)
    val currentStation: StateFlow<Station?> = _currentStation.asStateFlow()

    private val _isPlaying = MutableStateFlow(false)
    val isPlaying: StateFlow<Boolean> = _isPlaying.asStateFlow()

    private val _isBuffering = MutableStateFlow(false)
    val isBuffering: StateFlow<Boolean> = _isBuffering.asStateFlow()

    private val _nowPlaying = MutableStateFlow<String?>(null)
    val nowPlaying: StateFlow<String?> = _nowPlaying.asStateFlow()

    private val _favorites = MutableStateFlow<Set<String>>(emptySet())
    val favorites: StateFlow<Set<String>> = _favorites.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    // Pagination
    private var currentOffset = 0
    private val pageSize = 100
    private val _hasMore = MutableStateFlow(true)
    val hasMore: StateFlow<Boolean> = _hasMore.asStateFlow()

    // ── Media Browser ─────────────────────────────────────────────────────────

    private var mediaBrowser: MediaBrowserCompat? = null
    private var mediaController: MediaControllerCompat? = null

    private val connectionCallback = object : MediaBrowserCompat.ConnectionCallback() {
        override fun onConnected() {
            Log.d(TAG, "MediaBrowser connected")
            val browser = mediaBrowser ?: return
            mediaController = MediaControllerCompat(getApplication(), browser.sessionToken)
            mediaController?.registerCallback(mediaControllerCallback)
            syncPlaybackState()
        }

        override fun onConnectionFailed() {
            Log.e(TAG, "MediaBrowser connection failed")
        }
    }

    private val mediaControllerCallback = object : MediaControllerCompat.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackStateCompat?) {
            syncPlaybackState()
        }

        override fun onMetadataChanged(metadata: MediaMetadataCompat?) {
            if (metadata == null) {
                _nowPlaying.value = null
                return
            }
            val title = metadata.getString(MediaMetadataCompat.METADATA_KEY_TITLE)
            val artist = metadata.getString(MediaMetadataCompat.METADATA_KEY_ARTIST)
            
            if (!title.isNullOrBlank() && artist != "Live Radio") {
                _nowPlaying.value = "$artist - $title"
            } else if (!title.isNullOrBlank()) {
                _nowPlaying.value = title
            } else {
                _nowPlaying.value = null
            }
        }
    }

    private fun syncPlaybackState() {
        val state = mediaController?.playbackState?.state ?: PlaybackStateCompat.STATE_NONE
        _isPlaying.value = state == PlaybackStateCompat.STATE_PLAYING
        _isBuffering.value = state == PlaybackStateCompat.STATE_BUFFERING
    }

    fun connectToService() {
        val ctx = getApplication<Application>()
        mediaBrowser = MediaBrowserCompat(
            ctx,
            ComponentName(ctx, RadioPlaybackService::class.java),
            connectionCallback,
            null
        )
        mediaBrowser?.connect()
    }

    fun disconnectFromService() {
        mediaController?.unregisterCallback(mediaControllerCallback)
        mediaBrowser?.disconnect()
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    init {
        loadFavorites()
        loadStations(reset = true)
    }

    // ── Data Loading ──────────────────────────────────────────────────────────

    fun selectCategory(category: Category) {
        if (_selectedCategory.value == category) return
        _selectedCategory.value = category
        _searchQuery.value = "" // Clear search when category changes
        loadStations(reset = true)
    }

    fun search(query: String) {
        _searchQuery.value = query
        loadStations(reset = true)
    }

    fun loadMore() {
        if (_isLoading.value || !_hasMore.value) return
        loadStations(reset = false)
    }

    private fun loadStations(reset: Boolean) {
        val category = _selectedCategory.value
        val query = _searchQuery.value

        if (reset) {
            currentOffset = 0
            _hasMore.value = true
            _stations.value = emptyList()
        }

        viewModelScope.launch(Dispatchers.IO) {
            _isLoading.value = true
            _errorMessage.value = null
            try {
                val newStations = repository.fetchStations(category, offset = currentOffset, query = query)
                val current = if (reset) newStations else _stations.value + newStations
                _stations.value = current
                currentOffset += newStations.size
                _hasMore.value = newStations.size >= pageSize
                if (newStations.isEmpty() && reset) {
                    _hasMore.value = false
                }
            } catch (e: Exception) {
                Log.e(TAG, "loadStations error", e)
                _errorMessage.value = "Failed to load stations: ${e.message}"
            } finally {
                _isLoading.value = false
            }
        }
    }

    // ── Playback ──────────────────────────────────────────────────────────────

    fun playStation(station: Station) {
        _currentStation.value = station
        val ctx = getApplication<Application>()
        val intent = Intent(ctx, RadioPlaybackService::class.java).apply {
            putExtra(RadioPlaybackService.EXTRA_STREAM_URL, station.streamUrl)
            putExtra(RadioPlaybackService.EXTRA_STATION_NAME, station.name)
            putExtra(RadioPlaybackService.EXTRA_STATION_UUID, station.uuid)
            putExtra(RadioPlaybackService.EXTRA_FAVICON_URL, station.favicon)
        }
        ctx.startForegroundService(intent)
        _isPlaying.value = true
        _isBuffering.value = true
    }

    fun togglePlayPause() {
        val controller = mediaController
        if (controller != null) {
            val state = controller.playbackState?.state
            if (state == PlaybackStateCompat.STATE_PLAYING) {
                controller.transportControls.pause()
            } else {
                controller.transportControls.play()
            }
        } else {
            // Controller not connected yet — restart via intent
            _currentStation.value?.let { playStation(it) }
        }
    }

    fun stopPlayback() {
        mediaController?.transportControls?.stop()
        _currentStation.value = null
        _isPlaying.value = false
        _isBuffering.value = false
    }

    fun skipNext() {
        mediaController?.transportControls?.skipToNext()
    }

    fun skipPrevious() {
        mediaController?.transportControls?.skipToPrevious()
    }

    // ── Favorites ─────────────────────────────────────────────────────────────

    private fun loadFavorites() {
        _favorites.value = repository.getFavorites()
    }

    fun toggleFavorite(uuid: String) {
        repository.toggleFavorite(uuid)
        _favorites.value = repository.getFavorites()
    }

    fun isFavorite(uuid: String): Boolean = repository.isFavorite(uuid)

    // ── Cleanup ───────────────────────────────────────────────────────────────

    override fun onCleared() {
        disconnectFromService()
        super.onCleared()
    }
}
