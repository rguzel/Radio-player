package com.guzelradio.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val BackgroundColor = Color(0xFF0F172A)   // slate-900
val AccentColor = Color(0xFFF59E0B)       // amber-500
val CardBgColor = Color(0xFF1E293B)       // slate-800
val TextPrimary = Color(0xFFFFFFFF)
val TextSecondary = Color(0xFFCBD5E1)
val HealthGreen = Color(0xFF22C55E)
val HealthYellow = Color(0xFFEAB308)
val HealthRed = Color(0xFFEF4444)

private val DarkColorScheme = darkColorScheme(
    primary = AccentColor,
    onPrimary = Color.Black,
    secondary = AccentColor,
    onSecondary = Color.Black,
    background = BackgroundColor,
    onBackground = TextPrimary,
    surface = CardBgColor,
    onSurface = TextPrimary,
    surfaceVariant = CardBgColor,
    onSurfaceVariant = TextSecondary,
    outline = Color(0xFF334155)
)

@Composable
fun GuzelRadioTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
