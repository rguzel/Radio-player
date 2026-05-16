# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the Android SDK tools/proguard/proguard-android-optimize.txt

# Keep Retrofit + Gson model classes
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
-keep class com.guzelradio.data.** { *; }

# Retrofit
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }

# OkHttp
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }

# Media3 / ExoPlayer
-keep class androidx.media3.** { *; }

# AndroidX Media (MediaBrowserServiceCompat)
-keep class androidx.media.** { *; }
