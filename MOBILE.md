# ELIM Mobile Apps (iOS / Android)

This project is wrapped with [Capacitor](https://capacitorjs.com), which takes the same web app already deployed at ccelim.com and packages it into real iOS and Android app shells. The web code doesn't change or fork — the native apps just load the built `dist/` output inside a native container.

## What's already done (in this repo)

- `capacitor.config.ts` — app ID `com.ccelim.app`, app name "ELIM"
- `ios/` and `android/` — full native project scaffolding (Xcode project + Gradle project)
- App icons and splash screens generated from the real logo, at every required resolution for both platforms (`ios/App/App/Assets.xcassets`, `android/app/src/main/res/mipmap-*` and `drawable-*`)
- Source images for regenerating icons/splash later live in `/assets` (`icon.png`, `splash.png`) — if the logo ever changes, drop a new 1024×1024 icon and 2732×2732 splash in there and re-run `npx capacitor-assets generate`

## What I can't do from here

Building, signing, and submitting a mobile app requires tools that only run on your own machine, plus developer accounts only you can create:

| Platform | Requires | Cost |
|---|---|---|
| iOS | A Mac with **Xcode** installed | Free (Xcode itself) |
| iOS submission | **Apple Developer Program** membership | $99/year |
| Android | **Android Studio** (Windows/Mac/Linux all fine) | Free |
| Android submission | **Google Play Console** account | $25 one-time |

I have no access to macOS (Xcode is Mac-only) or a way to reach the Android SDK's download servers from this environment, so I can prepare everything up to the point of opening these projects — I can't compile, run on a simulator/device, or submit either app myself.

## Steps to actually build (on your machine)

1. Clone the repo and install dependencies:
   ```
   git clone https://github.com/jkabore97/elim.git
   cd elim
   npm install
   ```
2. Build the web app and sync it into both native projects:
   ```
   npm run build
   npx cap sync
   ```
   Run this **every time** you change the web code and want the native apps to pick it up — Capacitor bundles a snapshot, it doesn't live-load from ccelim.com.
3. **iOS** (on a Mac): `npx cap open ios` — opens Xcode. Set your Apple Developer team under Signing & Capabilities, then Product → Archive to submit via App Store Connect.
4. **Android**: `npx cap open android` — opens Android Studio. Build → Generate Signed Bundle/APK, then upload the `.aab` to Google Play Console.

## Before submitting to either store

- **App Store screenshots / Play Store listing** — both stores require actual screenshots at specific device sizes; I can help draft store-listing copy when you're ready, but the screenshots need to come from a real build.
- **Privacy policy URL** — both stores require one, and SECURITY.md in this repo covers most of what a basic policy page would need to say.
- **App icon review** — Apple in particular can reject icons with transparency or that don't match their design guidelines; the generated icon is already flattened to a solid background for this reason, but worth a final look in Xcode's asset catalog before submitting.
