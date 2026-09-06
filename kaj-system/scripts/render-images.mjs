// Renders og-image.png and the PNG icons from og-image.html / favicon.svg.
// Usage (from the kaj-system folder): node scripts/render-images.mjs
// Requires Playwright + Chromium: npx playwright install chromium
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Resolve Playwright from the project, or from PLAYWRIGHT_MODULE (e.g. a global install).
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.goto(pathToFileURL(path.join(root, 'og-image.html')).href, { waitUntil: 'networkidle' });
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: path.join(root, 'og-image.png') });

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<img src="${pathToFileURL(path.join(root, 'favicon.svg')).href}" style="width:${size}px;height:${size}px;display:block">`, { waitUntil: 'load' });
  await p.screenshot({ path: path.join(root, name), omitBackground: true });
}
await browser.close();
console.log('rendered og-image.png, icon-192.png, icon-512.png, apple-touch-icon.png');
