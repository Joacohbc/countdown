'use strict';

/** Resuelve la ruta al binario de Chrome/Chromium del sistema. */
const fs = require('fs');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function resolveChromePath() {
  for (const p of CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) { /* ignore */ }
  }
  throw new Error(
    'No se encontró Chrome/Chromium. Instalalo o definí CHROME_PATH=/ruta/al/chrome'
  );
}

module.exports = { resolveChromePath };
