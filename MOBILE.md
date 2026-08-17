# ELIM Mobile Apps (iOS / Android)

This project is wrapped with [Capacitor](https://capacitorjs.com), which takes the same web app already deployed at ccelim.com and packages it into real iOS and Android app shells. The web code doesn't change or fork — the native apps just load the built `dist/` output inside a native container.

## What's already done (in this repo)

- `capacitor.config.ts` — app ID `com.elim.app`, app name "ELIM"
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
   npm run cap:sync
   ```
   Run this **every time** you change the web code and want the native apps to pick it up — Capacitor bundles a snapshot, it doesn't live-load from ccelim.com.
3. **iOS** (on a Mac): `npx cap open ios` — opens Xcode. Set your Apple Developer team under Signing & Capabilities, then Product → Archive to submit via App Store Connect.
4. **Android**: `npm run cap:android` — opens Android Studio. First run does a Gradle sync (10–30 min, downloads SDK components). Use Device Manager to create an emulator, or enable USB debugging on a real phone (Settings → About phone → tap Build number ×7 → Developer options → USB debugging), then hit ▶ Run to test it as a real app.

### Package identity: `com.elim.app` (v1.04)

The app ships under the package name **`com.elim.app`** at **versionName `1.04` / versionCode `104`**. This is a *different application identity* from the earlier `com.ccelim.app` build, so on Play Console it is a **brand-new app listing** with its own reviews, install base and version history — not an update of the old one. The old listing is unaffected by anything here; leave it alone or unpublish it separately.

Consequences worth knowing before you upload:

- **A new keystore is fine, but be deliberate.** You may reuse the existing keystore or make a fresh one — Play ties signing to the listing, and this is a new listing either way. Whichever you pick, back it up permanently; losing it means never being able to update this app again.
- **Existing users do not migrate.** Anyone with the old app installed keeps it; the new one installs alongside as a separate app. There is no upgrade path between different package names.
- **versionCode must only ever increase** for this listing. `104` is the starting point; use `105`, `106`, … for later uploads.

#### Firebase registration — done

`com.elim.app` is registered as an Android app in the **same** Firebase project (`elim-b1fff`, project number `81584374169`), and `android/app/google-services.json` now carries client entries for **both** packages:

| Package | Firebase app id |
|---|---|
| `com.ccelim.app` (old listing) | `1:81584374169:android:a9fd2c2543b0b982389308` |
| `com.elim.app` (this listing) | `1:81584374169:android:d98c8dc45839b894389308` |

Because both apps live in one project they read the same Firestore data, Storage and Cloud Functions — so the new listing sees the existing posts, users and library, and the old app keeps working off its own unchanged client entry. FCM issues push tokens per *(Firebase app, package name)* pair, which is why this file has to list both.

Remaining Firebase task, only if you use a service that needs it: add the release signing certificate's **SHA-1/SHA-256** fingerprints to the `com.elim.app` app in Firebase. Plain FCM push does not require them.

### Android: signing and Play Store submission

1. **Build → Generate Signed Bundle / APK → Android App Bundle → Create new...** to make a keystore (`.jks`). Save it outside the project folder and **back it up permanently** — lose it and you can never update this app again under the same identity.
2. Finish the wizard on the **release** variant → produces the `.aab` file Play Console requires (not a plain APK).
3. Register at https://play.google.com/console ($25 one-time), create the app entry.
4. Under **Policy → App Content**, complete three mandatory forms (each needs a green checkmark): **Content rating** (IARC questionnaire), **Data safety** (declare what ELIM collects — maps to this doc's Data Collected section), **Target audience**.
5. Fill out the store listing: icon (512×512), feature graphic (1024×500), screenshots from a real running build, short description (80 chars), full description (4,000 chars).
6. **2026 requirement for new developer accounts:** a closed test with **at least 12 opted-in testers for 14 continuous days** is mandatory before Google allows a production release. Plan for this — it's the step most first-time publishers don't budget time for.
7. After the closed test window, submit to production.
8. For every future update: `npm run cap:sync`, bump `versionCode`/`versionName` in `android/app/build.gradle` (Play Console rejects duplicate version codes), regenerate the signed bundle, upload as a new release.

**Target SDK note:** this project already targets SDK 36 (Android 16) in `android/variables.gradle`, which is what Google requires for all new app submissions starting August 31, 2026 — already handled, nothing to change here.

## Before submitting to either store

- **App Store screenshots / Play Store listing** — both stores require actual screenshots at specific device sizes; I can help draft store-listing copy when you're ready, but the screenshots need to come from a real build.
- **Privacy policy URL** — both stores require one, and SECURITY.md in this repo covers most of what a basic policy page would need to say.
- **App icon review** — Apple in particular can reject icons with transparency or that don't match their design guidelines; the generated icon is already flattened to a solid background for this reason, but worth a final look in Xcode's asset catalog before submitting.
