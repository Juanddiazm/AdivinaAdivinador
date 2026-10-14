// Genera los íconos del lanzador (PNG) en app/src/main/res a partir del SVG del diseño.
// Usa Chromium vía Playwright para dibujar el "?" con la tipografía Bricolage de la app.
//   NODE_PATH=/ruta/a/node_modules node tools/make_icons.js
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'app/src/main/res');
// La fuente va embebida: una página creada con setContent no puede leer file://.
const FONT = 'data:font/woff2;base64,' + fs.readFileSync(path.join(ROOT, 'app/src/main/assets/web/bricolage-800.woff2')).toString('base64');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const VIOLET = '#5B3DF5', SUN = '#FFC233', INK = '#1A1433';
const BUBBLE = 'M38 22H70A16 16 0 0 1 86 38V56A16 16 0 0 1 70 72H52L34 88L37 72A16 16 0 0 1 22 56V38A16 16 0 0 1 38 22Z';

function bubble(stroke) {
  return `<path transform="translate(3 4)" d="${BUBBLE}" fill="${INK}"/>` +
    `<path d="${BUBBLE}" fill="${SUN}" stroke="${INK}" stroke-width="${stroke}" stroke-linejoin="round"/>` +
    `<text x="54" y="63" text-anchor="middle" font-family="Bricolage" font-weight="800" font-size="40" fill="${INK}">?</text>`;
}
const SPARKLE = '<path d="M90 12l2.4 5.6L98 20l-5.6 2.4L90 28l-2.4-5.6L82 20l5.6-2.4z" fill="#fff"/>';

// Ícono completo (Android 7 y Play Store): cuadrado redondeado violeta.
const legacy = (stroke) => `<rect width="108" height="108" rx="26" fill="${VIOLET}"/>${bubble(stroke)}${SPARKLE}`;
// Ícono adaptativo (Android 8+): el globo dentro de la zona segura (círculo de 66/108); el fondo va aparte.
const foreground = `<g transform="translate(54 56) scale(0.8) translate(-54 -56)">${bubble(4)}</g>`;

async function render(page, svgBody, px, file, transparent) {
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: "Bricolage"; src: url("${FONT}") format("woff2"); font-weight: 800; }
    html, body { margin: 0; background: transparent; }
    svg { display: block; }
  </style></head><body><svg id="s" width="${px}" height="${px}" viewBox="0 0 108 108">${svgBody}</svg></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.locator('#s').screenshot({ path: file, omitBackground: !!transparent });
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, k] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, 'mipmap-' + name);
    // Trazo un poco más grueso en tamaños chicos para que el contorno no desaparezca.
    await render(page, legacy(k <= 1.5 ? 5 : 4), Math.round(48 * k), path.join(dir, 'ic_launcher.png'), true);
    await render(page, foreground, Math.round(108 * k), path.join(dir, 'ic_launcher_foreground.png'), true);
    await render(page, `<rect width="108" height="108" fill="${VIOLET}"/>`, Math.round(108 * k), path.join(dir, 'ic_launcher_background.png'));
  }
  await render(page, legacy(4), 512, path.join(ROOT, 'app/src/main/ic_launcher-playstore.png'), true);
  await browser.close();
  console.log('íconos generados');
})();
