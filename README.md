# ELIM – Church Community App

**Domain:** [ccelim.com](https://ccelim.com)

A modern church community platform. Verified **church** accounts publish content — text, photos, audio, video, or documents — and **members** follow along, like, and comment. See [SECURITY.md](./SECURITY.md) for the full access-control and data policy.

## Features

- Real Firebase backend (Auth + Firestore + Storage) — not a mockup
- Email/password **and Google Sign-In**, plus self-service password reset
- Role-based access: member, church (verified), admin — enforced server-side in `firestore.rules`, not just hidden UI
- Church signup → admin approval flow (Admin tab with a pending-count badge)
- Posts: photo, audio (with optional cover image), video, YouTube/Facebook links, and PDF documents — real file uploads with size/type limits, not just pasted URLs
- Real per-user likes and comments
- Post editing (text) and deletion — restricted to the original poster only
- Editable profile: photo, church, country, city, phone number
- Responsive design: full marketing landing page + wide dashboard on desktop, native "app" feel (bottom nav, compact screens) on phone/tablet
- Installable as a PWA (manifest + icons)
- Wrapped for native **iOS and Android** via Capacitor — see [MOBILE.md](./MOBILE.md)

## Tech Stack

- React 19 + TypeScript, Vite, Tailwind CSS v4, Lucide React
- Firebase (Auth, Firestore, Storage)
- Capacitor (iOS/Android native wrapping)

## Local Development

```bash
npm install
npm run dev
```

## Deploy

Connected to Cloudflare (Workers/Pages) via this GitHub repo:
- Build command: `npm run build`
- Output directory: `dist`
- Custom domain: `ccelim.com`, configured under the project's **Custom domains** tab

After deploying, two rule files still need to be pasted into their respective Firebase console pages (Firestore Database → Rules, and Storage → Rules): [`firestore.rules`](./firestore.rules) and [`storage.rules`](./storage.rules).

## Mobile apps

```bash
npm run cap:sync      # build the web app + sync into ios/ and android/
npm run cap:android   # ...then open in Android Studio
npx cap open ios       # or open in Xcode (Mac only)
```

Full build/signing/store-submission walkthrough in [MOBILE.md](./MOBILE.md).

## Roadmap

Not built yet, tracked honestly in [SECURITY.md](./SECURITY.md#9-roadmap-known-gaps-not-yet-built): content reporting, rate limiting, malware scanning on uploads, account deletion/data export, admin MFA, audit logging.

---

Built for the ELIM community.
