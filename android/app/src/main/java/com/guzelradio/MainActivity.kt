package com.guzelradio

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.guzelradio.ui.StationListScreen
import com.guzelradio.ui.theme.GuzelRadioTheme
import com.guzelradio.viewmodel.StationViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: StationViewModel by viewModels()

    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
            // Playback works either way, but without notifications the user has
            // no playback controls outside the app — surface that in the UI so
            // they aren't stuck force-stopping the app to silence it.
            viewModel.refreshNotificationStatus()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Request POST_NOTIFICATIONS on Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        viewModel.connectToService()

        setContent {
            GuzelRadioTheme {
                StationListScreen(
                    viewModel = viewModel,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // The user may have toggled notifications in system settings while we
        // were backgrounded (including via the banner's "Open settings" link).
        viewModel.refreshNotificationStatus()
    }

    override fun onDestroy() {
        viewModel.disconnectFromService()
        super.onDestroy()
    }
}
