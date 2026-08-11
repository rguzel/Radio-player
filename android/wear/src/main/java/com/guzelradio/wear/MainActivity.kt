package com.guzelradio.wear

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import com.guzelradio.data.Category
import com.guzelradio.data.RadioRepository
import com.guzelradio.data.Station
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

// Color constants matching the theme (since shared core is not providing them)
val BackgroundColor = Color(0xFF0F172A)
val AccentColor = Color(0xFFF59E0B)
val CardBgColor = Color(0xFF1E293B)
val TextPrimary = Color(0xFFFFFFFF)
val TextSecondary = Color(0xFFCBD5E1)

class MainActivity : ComponentActivity() {
    
    private lateinit var repository: RadioRepository
    private val stations = MutableStateFlow<List<Station>>(emptyList())
    private val currentStation = MutableStateFlow<Station?>(null)
    private val isPlaying = MutableStateFlow(false)
    private val isBuffering = MutableStateFlow(false)
    private val playerError = MutableStateFlow<String?>(null)
    private val showPlayerView = MutableStateFlow(false)
    private val searchQuery = MutableStateFlow("")

    private var mediaBrowser: MediaBrowserCompat? = null
    private var mediaController: MediaControllerCompat? = null

    private val connectionCallback = object : MediaBrowserCompat.ConnectionCallback() {
        override fun onConnected() {
            val token = mediaBrowser?.sessionToken ?: return
            mediaController = MediaControllerCompat(this@MainActivity, token)
            mediaController?.registerCallback(controllerCallback)
            syncState()
        }
    }

    private val controllerCallback = object : MediaControllerCompat.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackStateCompat?) { syncState() }
        override fun onMetadataChanged(metadata: MediaMetadataCompat?) { syncState() }
    }

    private fun syncState() {
        val state = mediaController?.playbackState?.state ?: PlaybackStateCompat.STATE_NONE
        isPlaying.value = state == PlaybackStateCompat.STATE_PLAYING
        isBuffering.value = state == PlaybackStateCompat.STATE_BUFFERING
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = RadioRepository.getInstance(this)
        
        mediaBrowser = MediaBrowserCompat(
            this,
            ComponentName(this, WearPlaybackService::class.java),
            connectionCallback,
            null
        )
        mediaBrowser?.connect()
        
        loadStations()

        setContent {
            val stationList by stations.collectAsState()
            val current by currentStation.collectAsState()
            val playing by isPlaying.collectAsState()
            val buffering by isBuffering.collectAsState()
            val error by playerError.collectAsState()
            val showPlayer by showPlayerView.collectAsState()
            val query by searchQuery.collectAsState()

            // Handle Back Button
            val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
            DisposableEffect(showPlayer, query, current) {
                val callback = object : OnBackPressedCallback(showPlayer || query.isNotEmpty()) {
                    override fun handleOnBackPressed() {
                        if (showPlayer) {
                            showPlayerView.value = false
                        } else if (query.isNotEmpty()) {
                            searchQuery.value = ""
                            loadStations()
                        }
                    }
                }
                backDispatcher?.addCallback(callback)
                onDispose { callback.remove() }
            }

            MaterialTheme {
                WearApp(
                    stationList = stationList,
                    currentStation = current,
                    isPlaying = playing,
                    isBuffering = buffering,
                    errorMessage = error,
                    showPlayer = showPlayer,
                    searchQuery = query,
                    onSearch = { newQuery: String ->
                        searchQuery.value = newQuery
                        loadStations(newQuery)
                    },
                    onShowPlayer = { value: Boolean -> showPlayerView.value = value },
                    onPlay = { 
                        playStation(it)
                        showPlayerView.value = true
                    },
                    onTogglePlay = {
                        if (playing) mediaController?.transportControls?.pause() 
                        else mediaController?.transportControls?.play()
                    },
                    onSkip = { forward ->
                        val list = stationList
                        if (list.isNotEmpty()) {
                            val index = list.indexOfFirst { it.uuid == current?.uuid }
                            val next = if (forward) (index + 1) % list.size else (index - 1 + list.size) % list.size
                            playStation(list[next])
                        }
                    }
                )
            }
        }
    }

    private fun loadStations(query: String = "") {
        CoroutineScope(Dispatchers.IO).launch {
            val country = repository.getSelectedCountry()
            stations.value = repository.fetchStations(Category.ALL, query = query.takeIf { it.isNotEmpty() }, country = country)
        }
    }

    private fun playStation(station: Station) {
        currentStation.value = station
        playerError.value = null
        val intent = Intent(this, WearPlaybackService::class.java).apply {
            putExtra(WearPlaybackService.EXTRA_STREAM_URL, station.streamUrl)
        }
        startForegroundService(intent)
    }

    override fun onDestroy() {
        mediaBrowser?.disconnect()
        super.onDestroy()
    }
}

@Composable
fun WearApp(
    stationList: List<Station>,
    currentStation: Station?,
    isPlaying: Boolean,
    isBuffering: Boolean,
    errorMessage: String?,
    showPlayer: Boolean,
    searchQuery: String,
    onSearch: (String) -> Unit,
    onShowPlayer: (Boolean) -> Unit,
    onPlay: (Station) -> Unit,
    onTogglePlay: () -> Unit,
    onSkip: (Boolean) -> Unit
) {
    val listState = rememberScalingLazyListState()
    val focusRequester = remember { FocusRequester() }
    val coroutineScope = rememberCoroutineScope()
    var isInputMode by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize()) {
        if (!showPlayer) {
            ScalingLazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .onRotaryScrollEvent {
                        coroutineScope.launch {
                            listState.scrollBy(it.verticalScrollPixels)
                        }
                        true
                    }
                    .focusRequester(focusRequester)
                    .focusable(),
                state = listState,
                autoCentering = AutoCenteringParams(itemIndex = 0)
            ) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = if (searchQuery.isNotEmpty()) "Result: $searchQuery" else "Guzel Radio",
                            style = MaterialTheme.typography.caption1,
                            color = Color(0xFFF59E0B)
                        )
                        if (currentStation != null) {
                            Spacer(modifier = Modifier.width(8.dp))
                            IconButton(
                                onClick = { onShowPlayer(true) },
                                modifier = Modifier.size(24.dp)
                            ) {
                                Icon(Icons.Default.PlayArrow, contentDescription = "Back to player", modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }

                item {
                    if (isInputMode) {
                        var text by remember { mutableStateOf("") }
                        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                            // On Wear OS, standard TextField is not common, we usually use 
                            // a dedicated input screen or a simple custom input.
                            // For simplicity, let's use a basic Chip that shows "Type search"
                            // and when clicked we could use RemoteInput or just a simple toggle.
                            // Since I can't easily add a new Activity for input here, 
                            // I'll stick to a toggle for now but with proper Wear UI.
                            
                            BasicTextField(
                                value = text,
                                onValueChange = { newValue: String -> text = newValue },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(CardBgColor, RoundedCornerShape(8.dp))
                                    .padding(8.dp),
                                textStyle = MaterialTheme.typography.body1.copy(color = TextPrimary)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                                Button(onClick = { isInputMode = false }, colors = ButtonDefaults.secondaryButtonColors(), modifier = Modifier.size(ButtonDefaults.SmallButtonSize)) {
                                    Icon(Icons.Default.Close, contentDescription = "Cancel")
                                }
                                Button(onClick = { 
                                    isInputMode = false
                                    onSearch(text) 
                                }, modifier = Modifier.size(ButtonDefaults.SmallButtonSize)) {
                                    Icon(Icons.Default.Search, contentDescription = "Go")
                                }
                            }
                        }
                    } else {
                        Chip(
                            onClick = { isInputMode = true },
                            label = { Text("Search Stations") },
                            icon = { Icon(Icons.Default.Search, contentDescription = null) },
                            colors = ChipDefaults.secondaryChipColors(),
                            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)
                        )
                    }
                }

                if (errorMessage != null) {
                    item {
                        Text(text = errorMessage, color = Color.Red, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    }
                }
                items(stationList) { station ->
                    Chip(
                        onClick = { onPlay(station) },
                        label = { Text(station.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        secondaryLabel = { Text(station.displayCodec) },
                        colors = ChipDefaults.primaryChipColors(),
                        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)
                    )
                }
            }
            LaunchedEffect(Unit) {
                focusRequester.requestFocus()
            }
        } else {
            PlayerScreen(
                station = currentStation,
                isPlaying = isPlaying,
                isBuffering = isBuffering,
                onTogglePlay = onTogglePlay,
                onSkip = onSkip,
                onBack = { onShowPlayer(false) }
            )
        }
    }
}

@Composable
fun PlayerScreen(
    station: Station?,
    isPlaying: Boolean,
    isBuffering: Boolean,
    onTogglePlay: () -> Unit,
    onSkip: (Boolean) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val audioManager = remember { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    val focusRequester = remember { FocusRequester() }
    
    var volume by remember { mutableIntStateOf(audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)) }
    val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)

    Box(
        modifier = Modifier.fillMaxSize().onRotaryScrollEvent {
            val delta = if (it.verticalScrollPixels > 0) 1 else -1
            val newVol = (volume + delta).coerceIn(0, maxVolume)
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, newVol, 0)
            volume = newVol
            true
        }.focusRequester(focusRequester).focusable()
    ) {
        LaunchedEffect(Unit) { focusRequester.requestFocus() }

        Column(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(text = station?.name ?: "No Station", maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, style = MaterialTheme.typography.body1, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(4.dp))
            Text(text = if (isBuffering) "Buffering..." else if (isPlaying) "Live" else "Paused", style = MaterialTheme.typography.caption2, color = Color(0xFFF59E0B))
            Spacer(modifier = Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.VolumeUp, contentDescription = null, modifier = Modifier.size(12.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("${(volume * 100 / maxVolume)}%", style = MaterialTheme.typography.caption3)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onSkip(false) }) { Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous") }
                Button(onClick = onTogglePlay, modifier = Modifier.size(ButtonDefaults.LargeButtonSize), colors = ButtonDefaults.primaryButtonColors()) {
                    if (isBuffering) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), indicatorColor = Color.Black, trackColor = Color.Transparent)
                    } else {
                        Icon(if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = "Play/Pause")
                    }
                }
                IconButton(onClick = { onSkip(true) }) { Icon(Icons.Filled.SkipNext, contentDescription = "Next") }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Chip(onClick = onBack, label = { Text("List", fontSize = 10.sp) }, modifier = Modifier.height(24.dp).width(60.dp), colors = ChipDefaults.secondaryChipColors())
        }
    }
}

@Composable
fun IconButton(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Button(onClick = onClick, modifier = modifier.size(ButtonDefaults.SmallButtonSize), colors = ButtonDefaults.secondaryButtonColors()) { content() }
}
