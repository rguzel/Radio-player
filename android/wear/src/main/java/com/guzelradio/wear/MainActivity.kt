package com.guzelradio.wear

import android.content.Context
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.guzelradio.data.Category
import com.guzelradio.data.RadioRepository
import com.guzelradio.data.Station
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    
    private lateinit var repository: RadioRepository
    private val stations = MutableStateFlow<List<Station>>(emptyList())
    private var exoPlayer: ExoPlayer? = null
    private val currentStation = MutableStateFlow<Station?>(null)
    private val isPlaying = MutableStateFlow(false)
    private val isBuffering = MutableStateFlow(false)
    private val playerError = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = RadioRepository.getInstance(this)
        
        exoPlayer = ExoPlayer.Builder(this).build().apply {
            addListener(object : Player.Listener {
                override fun onIsPlayingChanged(playing: Boolean) {
                    this@MainActivity.isPlaying.value = playing
                }
                override fun onPlaybackStateChanged(state: Int) {
                    this@MainActivity.isBuffering.value = state == Player.STATE_BUFFERING
                }
                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    stop()
                    this@MainActivity.isPlaying.value = false
                    this@MainActivity.isBuffering.value = false
                    this@MainActivity.playerError.value = "Station Offline"
                }
            })
        }
        
        CoroutineScope(Dispatchers.IO).launch {
            val list = repository.fetchStations(Category.ALL)
            stations.value = list
        }

        setContent {
            val stationList by stations.collectAsState()
            val current by currentStation.collectAsState()
            val playing by isPlaying.collectAsState()
            val buffering by isBuffering.collectAsState()
            val error by playerError.collectAsState()

            MaterialTheme {
                WearApp(
                    stationList = stationList,
                    currentStation = current,
                    isPlaying = playing,
                    isBuffering = buffering,
                    errorMessage = error,
                    onPlay = { station -> 
                        playerError.value = null
                        playStation(station) 
                    },
                    onTogglePlay = {
                        if (playing) exoPlayer?.pause() else exoPlayer?.play()
                    },
                    onSkip = { forward ->
                        playerError.value = null
                        val list = stationList
                        if (list.isEmpty()) return@WearApp
                        val index = list.indexOfFirst { it.uuid == current?.uuid }
                        val nextIndex = if (forward) (index + 1) % list.size else (index - 1 + list.size) % list.size
                        playStation(list[nextIndex])
                    }
                )
            }
        }
    }

    private fun playStation(station: Station) {
        currentStation.value = station
        exoPlayer?.let { player ->
            player.stop()
            player.clearMediaItems()
            player.setMediaItem(MediaItem.fromUri(station.streamUrl.toUri()))
            player.prepare()
            player.play()
        }
    }

    override fun onDestroy() {
        exoPlayer?.release()
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
    onPlay: (Station) -> Unit,
    onTogglePlay: () -> Unit,
    onSkip: (Boolean) -> Unit
) {
    val listState = rememberScalingLazyListState()
    var showPlayer by remember { mutableStateOf(false) }

    // If a station starts playing, show player auto (optional, maybe better to stay on list)
    LaunchedEffect(currentStation) {
        if (currentStation != null) showPlayer = true
    }

    Box(modifier = Modifier.fillMaxSize()) {
        if (!showPlayer) {
            ScalingLazyColumn(
                modifier = Modifier.fillMaxSize(),
                state = listState,
                autoCentering = AutoCenteringParams(itemIndex = 0)
            ) {
                item {
                    Text(
                        text = "Guzel Radio",
                        modifier = Modifier.padding(bottom = 8.dp),
                        style = MaterialTheme.typography.caption1,
                        color = Color(0xFFF59E0B)
                    )
                }

                if (errorMessage != null) {
                    item {
                        Text(
                            text = errorMessage,
                            color = Color.Red,
                            style = MaterialTheme.typography.caption2,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
                        )
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
        } else {
            PlayerScreen(
                station = currentStation,
                isPlaying = isPlaying,
                isBuffering = isBuffering,
                onTogglePlay = onTogglePlay,
                onSkip = onSkip,
                onBack = { showPlayer = false }
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
    
    var volume by remember { 
        mutableIntStateOf(audioManager.getStreamVolume(AudioManager.STREAM_MUSIC))
    }
    val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)

    // Handle Rotary (Bezel) for Volume
    Box(
        modifier = Modifier
            .fillMaxSize()
            .onRotaryScrollEvent {
                val delta = if (it.verticalScrollPixels > 0) 1 else -1
                val newVol = (volume + delta).coerceIn(0, maxVolume)
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, newVol, 0)
                volume = newVol
                true
            }
            .focusRequester(focusRequester)
            .focusable()
    ) {
        LaunchedEffect(Unit) {
            focusRequester.requestFocus()
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = station?.name ?: "No Station",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.body1,
                fontWeight = FontWeight.Bold
            )
            
            Spacer(modifier = Modifier.height(4.dp))
            
            Text(
                text = if (isBuffering) "Buffering..." else if (isPlaying) "Live" else "Paused",
                style = MaterialTheme.typography.caption2,
                color = Color(0xFFF59E0B)
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Volume indicator
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.VolumeUp, contentDescription = null, modifier = Modifier.size(12.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("${(volume * 100 / maxVolume)}%", style = MaterialTheme.typography.caption3)
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Controls
            // Row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { onSkip(false) }) {
                    Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous")
                }

                Button(
                    onClick = onTogglePlay,
                    modifier = Modifier.size(ButtonDefaults.LargeButtonSize),
                    colors = ButtonDefaults.primaryButtonColors()
                ) {
                    if (isBuffering) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            indicatorColor = Color.Black,
                            trackColor = Color.Transparent
                        )
                    } else {
                        Icon(
                            if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                            contentDescription = "Play/Pause"
                        )
                    }
                }

                IconButton(onClick = { onSkip(true) }) {
                    Icon(Icons.Filled.SkipNext, contentDescription = "Next")
                }
            }
            
            Spacer(modifier = Modifier.height(8.dp))
            
            Chip(
                onClick = onBack,
                label = { Text("List", fontSize = 10.sp) },
                modifier = Modifier.height(24.dp).width(60.dp),
                colors = ChipDefaults.secondaryChipColors()
            )
        }
    }
}

@Composable
fun IconButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.size(ButtonDefaults.SmallButtonSize),
        colors = ButtonDefaults.secondaryButtonColors()
    ) {
        content()
    }
}
