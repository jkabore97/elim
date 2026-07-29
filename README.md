# ELIM – Church Community App

**Domain:** [ccelim.com](https://ccelim.com)

Modern mobile-first church community platform.  
Only verified **church profiles** can publish content (text + images, audio + cover image, or video).  
Regular members can view the feed and leave comments.

## Features

- Clean modern UI with palm-inspired green theme
- Role-based access (Church Admin vs Member)
- Feed with mixed media posts
- Comments
- Church discovery
- Create post flow (Photo / Audio / Video)
- Mobile bottom navigation
- Ready for Firebase backend

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- Lucide React
- Firebase-ready

## Local Development

```bash
npm install
npm run dev
```

## Deploy to Cloudflare Pages (recommended)

1. Connect this GitHub repo to Cloudflare Pages
2. Build command: `npm run build`
3. Output directory: `dist`
4. Add custom domain `ccelim.com` in Cloudflare Pages → Custom domains

## Next Steps

1. Add Firebase (Auth + Firestore + Storage) for real data
2. Add church verification flow
3. (Optional) Wrap with Capacitor for native Play Store / App Store apps

---

Built for the ELIM community.
