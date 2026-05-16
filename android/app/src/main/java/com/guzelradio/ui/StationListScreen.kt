package com.guzelradio.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.guzelradio.data.Category
import com.guzelradio.data.Station
import com.guzelradio.ui.theme.AccentColor
import com.guzelradio.ui.theme.BackgroundColor
import com.guzelradio.ui.theme.CardBgColor
import com.guzelradio.ui.theme.HealthGreen
import com.guzelradio.ui.theme.HealthRed
import com.guzelradio.ui.theme.HealthYellow
import com.guzelradio.ui.theme.TextPrimary
import com.guzelradio.ui.theme.TextSecondary
import com.guzelradio.viewmodel.StationViewModel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

@Composable
fun StationListScreen(
    viewModel: StationViewModel,
    modifier: Modifier = Modifier
) {
    val stations by viewModel.stations.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val selectedCategory by viewModel.selectedCategory.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val currentStation by viewModel.currentStation.collectAsState()
    val isPlaying by viewModel.isPlaying.collectAsState()
    val isBuffering by viewModel.isBuffering.collectAsState()
    val favorites by viewModel.favorites.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()

    val gridState = rememberLazyGridState()
    var isSearchExpanded by remember { mutableStateOf(false) }

    // Auto-load more when nearing the bottom
    LaunchedEffect(gridState) {
        snapshotFlow { gridState.layoutInfo }
            .map { info ->
                val total = info.totalItemsCount
                val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: 0
                total > 0 && lastVisible >= total - 4
            }
            .distinctUntilChanged()
            .collect { nearBottom ->
                if (nearBottom && !isLoading && hasMore) {
                    viewModel.loadMore()
                }
            }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BackgroundColor)
    ) {
        // App title bar / Search bar
        Box(modifier = Modifier.statusBarsPadding()) {
            if (isSearchExpanded) {
                TextField(
                    value = searchQuery,
                    onValueChange = { viewModel.search(it) },
                    placeholder = { Text("Search stations…", color = TextSecondary) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = CardBgColor,
                        unfocusedContainerColor = CardBgColor,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = AccentColor,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent
                    ),
                    shape = RoundedCornerShape(24.dp),
                    leadingIcon = {
                        Icon(Icons.Filled.Search, contentDescription = null, tint = TextSecondary)
                    },
                    trailingIcon = {
                        IconButton(onClick = {
                            isSearchExpanded = false
                            viewModel.search("")
                        }) {
                            Icon(Icons.Filled.Close, contentDescription = "Close search", tint = TextSecondary)
                        }
                    },
                    singleLine = true
                )
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Guzel Radio",
                        color = AccentColor,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    IconButton(onClick = { isSearchExpanded = true }) {
                        Icon(Icons.Filled.Search, contentDescription = "Search", tint = TextPrimary)
                    }
                }
            }
        }

        // Category tabs
        CategoryTabs(
            categories = Category.entries,
            selectedCategory = selectedCategory,
            onCategorySelected = { viewModel.selectCategory(it) }
        )

        // Error message
        if (errorMessage != null) {
            Text(
                text = errorMessage ?: "",
                color = HealthRed,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }

        // Station grid
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            state = gridState,
            contentPadding = PaddingValues(
                start = 8.dp,
                end = 8.dp,
                top = 8.dp,
                bottom = if (currentStation != null) 80.dp else 16.dp
            ),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.weight(1f)
        ) {
            items(stations, key = { it.uuid }) { station ->
                StationCard(
                    station = station,
                    isCurrentlyPlaying = station.uuid == currentStation?.uuid && isPlaying,
                    isFavorite = station.uuid in favorites,
                    onClick = { viewModel.playStation(station) },
                    onFavoriteToggle = { viewModel.toggleFavorite(station.uuid) }
                )
            }

            // Loading indicator or Load More button
            item(span = { GridItemSpan(2) }) {
                when {
                    isLoading -> {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp)
                        ) {
                            CircularProgressIndicator(
                                color = AccentColor,
                                modifier = Modifier.size(32.dp)
                            )
                        }
                    }
                    hasMore && stations.isNotEmpty() -> {
                        Button(
                            onClick = { viewModel.loadMore() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = CardBgColor,
                                contentColor = AccentColor
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 32.dp, vertical = 8.dp)
                        ) {
                            Text(text = "Load More", fontSize = 14.sp)
                        }
                    }
                    stations.isEmpty() && !isLoading -> {
                        Text(
                            text = "No stations found",
                            color = TextSecondary,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp)
                        )
                    }
                }
            }
        }

        // Player bar at bottom
        PlayerBar(
            station = currentStation,
            isPlaying = isPlaying,
            isBuffering = isBuffering,
            isFavorite = currentStation?.uuid?.let { it in favorites } ?: false,
            onPlayPause = { viewModel.togglePlayPause() },
            onFavoriteToggle = {
                currentStation?.uuid?.let { viewModel.toggleFavorite(it) }
            },
            onSkipNext = { viewModel.skipNext() },
            onSkipPrevious = { viewModel.skipPrevious() },
            modifier = Modifier.navigationBarsPadding()
        )
    }
}

@Composable
fun StationCard(
    station: Station,
    isCurrentlyPlaying: Boolean,
    isFavorite: Boolean,
    onClick: () -> Unit,
    onFavoriteToggle: () -> Unit,
    modifier: Modifier = Modifier
) {
    val borderColor = if (isCurrentlyPlaying) AccentColor else Color.Transparent
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(CardBgColor)
            .border(
                width = 1.5.dp,
                color = borderColor,
                shape = RoundedCornerShape(12.dp)
            )
            .clickable { onClick() }
            .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Logo / initials with health dot
        Box(contentAlignment = Alignment.BottomEnd) {
            StationAvatar(
                faviconUrl = station.favicon,
                initials = station.initials,
                size = 56
            )
            HealthDot(healthScore = station.healthScore)
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Station name
        Text(
            text = station.name,
            color = TextPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(4.dp))

        // Codec + bitrate
        Text(
            text = station.displayCodec,
            color = TextSecondary,
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(6.dp))

        // Favorite button row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            IconButton(
                onClick = onFavoriteToggle,
                modifier = Modifier.size(24.dp)
            ) {
                Icon(
                    imageVector = if (isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    contentDescription = "Favorite",
                    tint = if (isFavorite) AccentColor else TextSecondary,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

@Composable
fun HealthDot(
    healthScore: Float?,
    modifier: Modifier = Modifier
) {
    val color = when {
        healthScore == null -> Color.Transparent
        healthScore >= 0.70f -> HealthGreen
        healthScore >= 0.40f -> HealthYellow
        else -> HealthRed
    }
    if (healthScore != null) {
        Box(
            modifier = modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color)
                .border(1.dp, CardBgColor, CircleShape)
        )
    }
}
