# Play Console store assets

Generated from `public/elim-logo-mark.png`.

## App icon (required: PNG/JPEG, exactly 512x512, max 1 MB, no transparency)

| File | Background | Notes |
|---|---|---|
| `play-icon-orange-512.png` | brand orange gradient | Matches the app's orange theme. Most distinctive at the small sizes Play actually shows. |
| `play-icon-cream-512.png` | warm cream | Closest to the previous white icon; keeps the logo colours truest. |

Both are 512x512, 3-channel (no alpha), well under 1 MB. The mark is inset to
about 78% of the canvas so Play's rounded-corner masking never clips it - the
previous `assets/icon.png` ran the art to the edges and sat low-left.

Do not add your own rounded corners or drop shadow; Play applies its own.

## Still needed for the listing

- Feature graphic: 1024x500 PNG/JPEG
- Phone screenshots: at least 2, 16:9 or 9:16, each 320-3840 px per side
