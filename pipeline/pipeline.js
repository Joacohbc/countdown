'use strict';

/**
 * pipeline.js — Daemon que mantiene los GIFs al día.
 *
 * Cada INTERVAL_MS (default 300000 = 5 min) escanea ../programmed-timers/*.json
 * y re-renderiza el GIF de cada timer en ../gifs/<name>.gif sobreescribiéndolo.
 * Reutiliza una sola instancia de Chrome para que cada ciclo sea rápido.
 *
 *   node pipeline.js          -> corre en loop para siempre (Ctrl+C para salir)
 *   node pipeline.js --once   -> renderiza una sola vez y termina
 *
 * Variables de entorno:
 *   INTERVAL_MS   intervalo entre ciclos (default 300000 = 5 min)
 *   CHROME_PATH   ruta a Chrome/Chromium (autodetecta si no se define)
 *   TIMERS_DIR    carpeta de JSONs (default ../programmed-timers)
 *
 * El GIF dura 10 min contando hacia abajo y se congela; regenerándolo cada
 * pocos minutos siempre arranca cerca del "ahora". En GitHub Actions esto corre
 * en modo --once cada 5 min (ver .github/workflows). Como daemon propio, bajá
 * INTERVAL_MS para menos staleness (cada render tarda ~25s con 600 frames).
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { renderTimer, ROOT } = require('./render');
const { resolveChromePath } = require('./chrome');

const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '300000', 10);
const TIMERS_DIR = process.env.TIMERS_DIR || path.join(ROOT, 'programmed-timers');
const ONCE = process.argv.includes('--once');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

let stopping = false; // se activa al recibir SIGINT/SIGTERM

function loadTimers() {
  if (!fs.existsSync(TIMERS_DIR)) return [];
  return fs
    .readdirSync(TIMERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(TIMERS_DIR, f);
      try {
        const cfg = JSON.parse(fs.readFileSync(full, 'utf8'));
        cfg.name = cfg.name || path.basename(f, '.json');
        return cfg;
      } catch (e) {
        console.error(`[${ts()}] ✗ JSON inválido en ${f}: ${e.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

async function runCycle(browser) {
  const timers = loadTimers();
  if (timers.length === 0) {
    console.warn(`[${ts()}] (sin timers en ${TIMERS_DIR})`);
    return;
  }
  for (const cfg of timers) {
    const t0 = Date.now();
    try {
      const res = await renderTimer(cfg, browser);
      console.log(
        `[${ts()}] ✓ ${cfg.name} -> ${(res.bytes / 1024).toFixed(1)} KB ` +
        `(${res.frames}f, ${Date.now() - t0}ms)`
      );
    } catch (e) {
      if (stopping) return; // error esperable: cerramos el browser a mitad de captura
      console.error(`[${ts()}] ✗ ${cfg.name}: ${e.message}`);
    }
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars'],
  });

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[${ts()}] cerrando...`);
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (ONCE) {
    await runCycle(browser);
    await browser.close();
    return;
  }

  console.log(`[${ts()}] watch cada ${INTERVAL_MS}ms — timers: ${TIMERS_DIR}`);
  while (!stopping) {
    const start = Date.now();
    await runCycle(browser);
    const wait = Math.max(0, INTERVAL_MS - (Date.now() - start));
    if (!stopping) await sleep(wait);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
