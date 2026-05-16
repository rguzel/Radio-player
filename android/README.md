# Guzel Radio — Android App

A native Android radio player for [radio.recepguzel.com](https://radio.recepguzel.com), matching the web app's design. Streams live radio from the RadioBrowser API, with Android Auto support, health indicators, and favourites.

---

## Requirements

- Android Studio Hedgehog (2023.1.1) or newer **or** Android command-line tools
- JDK 17+
- Android SDK with API 35 platform + build-tools 35.x
- A physical or virtual Android device running API 26+

---

## First-time Setup: Gradle Wrapper JAR

The binary `gradle/wrapper/gradle-wrapper.jar` is **not committed** (it's a binary blob). Generate it once:

```bash
cd /home/admincik/radio/android

# Option A — if you have any Gradle version installed globally
gradle wrapper --gradle-version 8.7

# Option B — download wrapper jar directly (no Gradle needed)
mkdir -p gradle/wrapper
curl -L \
  https://raw.githubusercontent.com/gradle/gradle/v8.7.0/gradle/wrapper/gradle-wrapper.jar \
  -o gradle/wrapper/gradle-wrapper.jar
```

After this, `./gradlew` is fully self-contained.

---

## Build

### Debug APK (fastest)

```bash
cd /home/admincik/radio/android
./gradlew assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`

### Release APK (minified)

```bash
./gradlew assembleRelease
```

You will need a signing keystore. Add to `app/build.gradle.kts`:

```kotlin
signingConfigs {
    create("release") {
        storeFile = file("keystore.jks")
        storePassword = "your_password"
        keyAlias = "your_alias"
        keyPassword = "your_key_password"
    }
}
buildTypes {
    release {
        signingConfig = signingConfigs.getByName("release")
    }
}
```

---

## Install on Device

```bash
# Enable USB debugging on the device, then:
./gradlew installDebug
```

Or via ADB:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## Android Auto Registration

Android Auto requires a **one-time approval** from Google before your app can appear in the car UI outside of developer mode.

### During Development (no approval needed)

1. Install the **Android Auto** app on your phone (version 7.x+)
2. In Android Auto → Settings → Version (tap 10 times) → Enable developer mode
3. In developer mode: allow "Unknown sources"
4. Connect phone to car head unit or use the Desktop Head Unit emulator

### Production Release

Before publishing to the Play Store with Android Auto support:

1. Go to [Google Play Console](https://play.google.com/console)
2. Your app → Store presence → Android Auto
3. Fill out the **Android Auto review form** (confirms your app follows Auto guidelines: no text entry while driving, large touch targets, etc.)
4. Google typically responds within 1–2 weeks

### Desktop Head Unit (DHU) Testing without a Car

```bash
# Install DHU from Android Studio SDK Manager → SDK Tools → Android Auto Desktop Head Unit
# Then run:
cd ~/Android/Sdk/extras/google/auto
./desktop-head-unit
```

Start Android Auto on the phone and connect via ADB:

```bash
adb forward tcp:5277 tcp:5277
```

---

## Architecture Overview

```
MainActivity
  └── StationListScreen (Compose)
        ├── CategoryTabs        — horizontal scrolling chip row
        ├── LazyVerticalGrid    — 2-column station cards
        │     └── StationCard   — logo, name, codec, health dot, favourite
        └── PlayerBar           — persistent bottom bar when a station is loaded

StationViewModel (AndroidViewModel)
  ├── RadioRepository           — fetches from RadioBrowser + merges health
  │     ├── RadioBrowserApi     — Retrofit interface for de1.api.radio-browser.info
  │     └── HealthApi           — Retrofit interface for radio.recepguzel.com
  └── MediaBrowserCompat        — binds to RadioPlaybackService for playback state

RadioPlaybackService (MediaBrowserServiceCompat)
  ├── ExoPlayer                 — actual stream playback
  ├── MediaSessionCompat        — lock screen / notification / Auto controls
  └── onLoadChildren()          — serves category + station tree for Android Auto
```

---

## API Endpoints Used

| Purpose | URL |
|---------|-----|
| All stations (Türkiye) | `GET https://de1.api.radio-browser.info/json/stations/bycountry/T%C3%BCrkiye` |
| By tag (category) | `GET .../stations/search?tagList={tag}&country=Türkiye` |
| By UUID list | `GET .../stations/byuuid?uuids=a,b,c` |
| Health batch | `GET https://radio.recepguzel.com/api/health?uuids=a,b,c` |
| Top stations | `GET https://radio.recepguzel.com/api/health/top?limit=50` |
| Report success | `POST https://radio.recepguzel.com/api/health/{uuid}/success` |
| Report failure | `POST https://radio.recepguzel.com/api/health/{uuid}/failure` |

---

## Favourites

Stored as a `Set<String>` of station UUIDs in `SharedPreferences` (key `favorites`, file `guzel_radio_prefs`). No backend required.

---

## Troubleshooting

**Build fails with `Could not find com.android.tools.build:gradle:8.4.0`**
→ Make sure you have Android Studio Hedgehog+ or have added `google()` to your global Gradle settings.

**ExoPlayer can't connect to stream**
→ Some stations in RadioBrowser have dead URLs. The health API success/failure reporting helps surface good streams over time.

**Android Auto shows "App not supported"**
→ Enable developer mode in the Android Auto app (tap version number 10 times).
