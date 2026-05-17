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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.guzelradio.data.Category
import com.guzelradio.data.Country
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
import kotlinx.coroutines.launch

@Composable
fun StationListScreen(
    viewModel: StationViewModel,
    modifier: Modifier = Modifier
) {
    val stations by viewModel.stations.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val selectedCategory by viewModel.selectedCategory.collectAsState()
    val selectedCountry by viewModel.selectedCountry.collectAsState()
    val countries by viewModel.countries.collectAsState()
    val showWizard by viewModel.showWizard.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val currentStation by viewModel.currentStation.collectAsState()
    val isPlaying by viewModel.isPlaying.collectAsState()
    val isBuffering by viewModel.isBuffering.collectAsState()
    val nowPlaying by viewModel.nowPlaying.collectAsState()
    val favorites by viewModel.favorites.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()

    val gridState = rememberLazyGridState()
    var isSearchExpanded by remember { mutableStateOf(false) }
    var showCountryPicker by remember { mutableStateOf(false) }

    // First run wizard / Country selector
    if (showWizard || showCountryPicker) {
        CountrySelectionDialog(
            countries = countries,
            onCountrySelected = { countryName ->
                viewModel.setCountry(countryName)
                showCountryPicker = false
            },
            onDismiss = { showCountryPicker = false },
            isDismissible = !showWizard
        )
    }

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
                    
                    // Country display/selector
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(CardBgColor)
                            .clickable { showCountryPicker = true }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Language,
                            contentDescription = null,
                            tint = AccentColor,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = selectedCountry,
                            color = TextPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Spacer(modifier = Modifier.width(8.dp))

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
            nowPlaying = nowPlaying,
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
fun CountrySelectionDialog(
    countries: List<Country>,
    onCountrySelected: (String) -> Unit,
    onDismiss: () -> Unit,
    isDismissible: Boolean
) {
    Dialog(
        onDismissRequest = { if (isDismissible) onDismiss() },
        properties = DialogProperties(
            dismissOnBackPress = isDismissible,
            dismissOnClickOutside = isDismissible,
            usePlatformDefaultWidth = false
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(BackgroundColor.copy(alpha = 0.95f))
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp)
            ) {
                Text(
                    text = "Select Country",
                    color = AccentColor,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Choose a country to discover local radio stations.",
                    color = TextSecondary,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(top = 8.dp, bottom = 24.dp)
                )

                var filterQuery by remember { mutableStateOf("") }
                
                TextField(
                    value = filterQuery,
                    onValueChange = { filterQuery = it },
                    placeholder = { Text("Search country...", color = TextSecondary) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = CardBgColor,
                        unfocusedContainerColor = CardBgColor,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = AccentColor,
                        focusedIndicatorColor = AccentColor,
                        unfocusedIndicatorColor = Color.Transparent
                    ),
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true
                )

                val filteredCountries = remember(countries, filterQuery) {
                    countries.filter { it.name.contains(filterQuery, ignoreCase = true) }
                }

                if (countries.isEmpty()) {
                    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = AccentColor)
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(filteredCountries) { country ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { onCountrySelected(country.name) }
                                    .padding(vertical = 12.dp, horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = country.name,
                                    color = TextPrimary,
                                    fontSize = 16.sp,
                                    modifier = Modifier.weight(1f)
                                )
                                Text(
                                    text = "${country.stationCount} stations",
                                    color = TextSecondary,
                                    fontSize = 12.sp
                                )
                            }
                            HorizontalDivider(color = Color(0xFF334155), thickness = 0.5.dp)
                        }
                    }
                }
                
                if (isDismissible) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = onDismiss,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = CardBgColor, contentColor = TextPrimary)
                    ) {
                        Text("Cancel")
                    }
                }
            }
        }
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
