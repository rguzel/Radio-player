package com.guzelradio.wear

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.wear.compose.material.AutoCenteringParams
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.items
import androidx.wear.compose.material.rememberScalingLazyListState
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = RadioRepository.getInstance(this)
        exoPlayer = ExoPlayer.Builder(this).build()
        
        CoroutineScope(Dispatchers.IO).launch {
            val list = repository.fetchStations(Category.ALL)
            stations.value = list
        }

        setContent {
            WearApp(
                stationList = stations.collectAsState().value,
                onPlay = { station ->
                    exoPlayer?.let { player ->
                        player.stop()
                        player.clearMediaItems()
                        player.setMediaItem(MediaItem.fromUri(Uri.parse(station.streamUrl)))
                        player.prepare()
                        player.play()
                    }
                }
            )
        }
    }

    override fun onDestroy() {
        exoPlayer?.release()
        super.onDestroy()
    }
}

@Composable
fun WearApp(stationList: List<Station>, onPlay: (Station) -> Unit) {
    val listState = rememberScalingLazyListState()
    
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        autoCentering = AutoCenteringParams(itemIndex = 0)
    ) {
        item {
            Text(
                text = "Guzel Radio",
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }
        
        items(stationList) { station ->
            Chip(
                onClick = { onPlay(station) },
                label = { Text(station.name) },
                secondaryLabel = { Text(station.displayCodec) },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.padding(bottom = 4.dp)
            )
        }
    }
}
