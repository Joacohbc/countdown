'use strict';

/**
 * render.js — Renderiza UN timer (config JSON) a un GIF usando el MISMO
 * countdown.html del repo, así el GIF se ve idéntico al frontend final.
 *
 * Estrategia: abrimos countdown.html?<params> en Chrome headless, capturamos
 * N screenshots espaciados en el tiempo (el countdown corre solo: tick cada 1s,
 * animaciones flip/pulse) y los empaquetamos en un GIF que loopea.
 *
 * Uso como módulo:   const { renderTimer } = require('./render');
 * Uso directo (CLI): node render.js ../programmed-timers/cyber-2026.json
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const ROOT = path.resolve(__dirname, '..');
const COUNTDOWN_HTML = path.join(ROOT, 'countdown.html');
const GIFS_DIR = path.join(ROOT, 'gifs');

// Mismos parámetros de color que entiende countdown.html
const COLOR_KEYS = [
  'bg', 'box_fill', 'box_border',
  'color_number', 'color_label', 'color_separator', 'color_accent',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Arma la URL file:// a countdown.html con los params del timer. */
function buildUrl(cfg) {
  const params = new URLSearchParams();
  if (cfg.target) params.set('target', cfg.target);
  if (cfg.expired_text) params.set('expired_text', cfg.expired_text);
  const colors = cfg.colors || {};
  for (const k of COLOR_KEYS) {
    if (colors[k]) params.set(k, colors[k]);
  }
  const url = pathToFileURL(COUNTDOWN_HTML);
  url.search = params.toString();
  return url.toString();
}

/**
 * Renderiza el timer y escribe gifs/<name>.gif.
 * @param {object} cfg     Config del timer (ya con .name resuelto).
 * @param {import('puppeteer-core').Browser} browser  Instancia reutilizable.
 * @returns {Promise<{path:string,bytes:number,frames:number}>}
 */
const FRAME_MS = 1000;        // 1 frame por segundo -> playback en tiempo real
const MAX_DURATION = 3600;    // tope de seguridad: 1h = 3600 frames

/**
 * Inyectado ANTES del script de countdown.html. Hace dos cosas:
 *  1) Reloj controlable: Date.now()/new Date() devuelven un instante que
 *     manejamos desde Node (__setNow), así generamos cada segundo del conteo
 *     sin esperar en tiempo real.
 *  2) Captura el tick del setInterval(.,1000) para dispararlo nosotros por frame
 *     (y evita que la página tickee sola en tiempo real).
 * No modifica countdown.html: es 100% el mismo HTML/CSS/JS final.
 */
function installClock(start) {
  const RealDate = Date;
  let fake = start;
  window.__setNow = (ms) => { fake = ms; };
  function FakeDate(...args) {
    return args.length ? new RealDate(...args) : new RealDate(fake);
  }
  FakeDate.now = () => fake;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  window.Date = FakeDate;

  const realSetInterval = window.setInterval;
  window.__tick = null;
  window.setInterval = (fn, ms) => {
    if (ms === 1000 && !window.__tick) { window.__tick = fn; return 0; }
    return realSetInterval(fn, ms);
  };
}

async function renderTimer(cfg, browser) {
  const g = cfg.gif || {};
  const width = g.width || 700;
  const height = g.height || 220;
  const scale = g.scale || 1;            // deviceScaleFactor (2 = nítido/retina)
  // Largo del GIF = ventana de cuenta regresiva (1 frame/seg). Default 10 min.
  const durationSeconds = Math.max(1, Math.min(MAX_DURATION, g.durationSeconds || 600));

  const outW = width * scale;
  const outH = height * scale;

  const startMs = Date.now();
  const targetMs = new Date(cfg.target).getTime();

  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(installClock, startMs);
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.goto(buildUrl(cfg), { waitUntil: 'networkidle0' });
    // Sin animaciones CSS: cada frame es nítido y determinista (solo cambian los dígitos).
    await page.addStyleTag({ content: '*{animation:none !important;transition:none !important;}' });

    const encoder = GIFEncoder();
    let written = 0;
    for (let i = 0; i < durationSeconds; i++) {
      const nowMs = startMs + i * 1000;
      await page.evaluate((ms) => { window.__setNow(ms); if (window.__tick) window.__tick(); }, nowMs);

      const shot = await page.screenshot({ type: 'png' });
      const { data } = PNG.sync.read(shot); // RGBA, outW*outH*4
      const palette = quantize(data, 256, { format: 'rgba4444' });
      const index = applyPalette(data, palette, 'rgba4444');
      encoder.writeFrame(index, outW, outH, {
        palette,
        delay: FRAME_MS,
        // repeat:-1 en el 1er frame => reproduce UNA vez y congela el último (no loop).
        repeat: i === 0 ? -1 : undefined,
      });
      written++;

      // Si llegamos al target, ya escribimos el frame 'expired': congelamos acá.
      if (Number.isNaN(targetMs) || nowMs >= targetMs) break;
    }
    encoder.finish();

    fs.mkdirSync(GIFS_DIR, { recursive: true });
    const outPath = path.join(GIFS_DIR, `${cfg.name}.gif`);
    const bytes = encoder.bytesView();
    // Escritura atómica: tmp + rename, para no servir un GIF a medio escribir.
    const tmp = `${outPath}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(bytes));
    fs.renameSync(tmp, outPath);

    return { path: outPath, bytes: bytes.length, frames: written };
  } finally {
    await page.close();
  }
}

module.exports = { renderTimer, buildUrl, GIFS_DIR, ROOT };

// --- CLI: node render.js <archivo.json> -------------------------------------
if (require.main === module) {
  const puppeteer = require('puppeteer-core');
  const { resolveChromePath } = require('./chrome');

  (async () => {
    const file = process.argv[2];
    if (!file) {
      console.error('Uso: node render.js <ruta/al/timer.json>');
      process.exit(1);
    }
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.name = cfg.name || path.basename(file, '.json');

    const browser = await puppeteer.launch({
      executablePath: resolveChromePath(),
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars'],
    });
    try {
      const res = await renderTimer(cfg, browser);
      console.log(`✓ ${cfg.name}: ${res.path} (${(res.bytes / 1024).toFixed(1)} KB, ${res.frames} frames)`);
    } finally {
      await browser.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
