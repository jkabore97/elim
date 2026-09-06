# Kaj System — website

Marketing site for **Kaj System**, an app & software studio. A single static
site: no build step, no framework, no dependencies. Open `index.html` in a
browser or deploy the folder as-is.

## What is in it

| Section | Notes |
| --- | --- |
| Hero | Animated phone mock-up, floating proof cards, trust chips |
| Services | 6 offerings (mobile, web, custom systems, design, AI, support) |
| Work | ELIM case study + 6 ready-to-adapt solution cards |
| Process | 6-step timeline from discovery call to launch |
| Why Kaj System | 4 differentiators |
| Pricing | 3 fixed-price packages, custom quote, monthly care plan |
| **Instant estimator** | Visitors pick platform + features + speed and get a price/timeline range they can send straight into the contact form |
| Testimonials | Hidden until `config.js` contains real quotes |
| FAQ | 6 accordions |
| Contact | Form (Formspree or mailto fallback) + email / WhatsApp / booking links |

Extras: English + French (auto-detected, switchable), light/dark theme,
scroll-spy navigation, SEO/Open Graph/JSON-LD tags, sitemap, robots,
PWA manifest, security headers for Cloudflare Pages, 404 and thank-you pages,
privacy policy.

## Edit the content

* **`config.js`** — everything a non-developer changes: email, WhatsApp
  number, booking link, form endpoint, social links, prices, estimator
  numbers, testimonials.
* **`i18n.js`** — all visible text, in English (`en`) and French (`fr`).
  Every key must exist in both blocks.
* **`index.html`** — structure. Add or remove sections here.
* **`styles.css`** — colours live in the `:root` block at the top.

### Make the contact form deliver to your inbox

1. Create a free form at <https://formspree.io> (or any service that accepts a
   JSON POST) and copy the endpoint URL.
2. Paste it into `config.js` → `contact.formEndpoint`.

Until an endpoint is set, submitting the form opens the visitor's email client
with the message pre-filled, addressed to `contact.email`.

### Turn on WhatsApp and booking buttons

Fill `contact.whatsapp` (international number, digits only, e.g.
`22670000000`) and/or `contact.bookingUrl` in `config.js`. The buttons and the
floating WhatsApp bubble appear automatically.

## Deploy to Cloudflare Pages

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Pick this repository and branch.
3. Framework preset: **None**. Build command: *(leave empty)*.
   Build output directory: **`kaj-system`**.
4. Add your domain under **Custom domains**.

Any static host works the same way (Netlify, Vercel, GitHub Pages, Firebase
Hosting): publish the `kaj-system` folder.

After choosing the final domain, update the URL in `config.js`, the
`<link rel="canonical">` / Open Graph tags in `index.html`, `sitemap.xml` and
`robots.txt`.

## Regenerate the icons and social image

The PNG icons and `og-image.png` are rendered from `og-image.html` /
`favicon.svg` with headless Chromium:

```bash
node scripts/render-images.mjs
```
