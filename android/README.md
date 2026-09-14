# Sala de Proyección — Android companion

This directory contains an Android companion application for the existing Sala de Proyección web product.

## What it is

The app is a lightweight Android WebView shell around the production web application at:

`https://sala-de-proyeccion.onrender.com/`

It preserves JavaScript, DOM storage, media playback and web file selection so the existing web workflow can be used from Android.

## Build

The project uses Android Gradle Plugin 8.7.3, compile/target SDK 35 and Java 17 on the build runner.

From Android Studio, open the `android/` directory and build the `app` module.

For a Play-ready release, configure the buyer's own release signing key. **Do not commit private signing keys to GitHub.**

## Automated build

GitHub Actions builds an unsigned release AAB and APK and stores them as workflow artifacts. The artifact is intended for the owner/buyer to download and sign with their own release key before publishing to Google Play.

## Scope

This is an Android companion/wrapper for the web application, not a claim that the underlying product is a native Android implementation.
