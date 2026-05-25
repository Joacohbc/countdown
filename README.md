# Cyber Countdown — Editor + Pipeline a GIF

Countdown estático (`countdown.html`) configurable por query params, un editor
visual (`index.html`) que **exporta un JSON**, y un **pipeline** que renderiza
ese JSON a un **GIF animado idéntico al HTML final** y lo mantiene al día.

## Estructura

```
countdown.html            Frontend del countdown (lee config de la URL)
index.html                Editor visual -> exporta el JSON del timer
programmed-timers/*.json  Un JSON por timer (config persistida en el repo)
gifs/<name>.gif           Salida del pipeline (mismo nombre, se sobreescribe)
pipeline/                 Renderizador Node (Chrome headless -> GIF)
.github/workflows/        GitHub Action que regenera y commitea los GIFs
```

## Flujo

1. Abrís `index.html`, configurás el countdown (fecha, colores, duración del GIF).
2. Le das **"Descargar .json"** y guardás el archivo en `programmed-timers/`.
3. El pipeline lee cada `programmed-timers/*.json`, abre `countdown.html` con esos
   params en Chrome headless y genera un GIF que **cuenta hacia abajo segundo a
   segundo** (1 frame/seg) durante la ventana configurada, **reproduce una vez y
   se congela** en el último frame (no loopea).
4. El GIF siempre tiene el mismo nombre, así cualquier `<img src=".../cyber-2026.gif">`
   queda al día sin cambiar la URL. Como se **regenera cada pocos minutos**, cuando
   alguien lo abre ya arranca cerca del "ahora".

### ¿Por qué "cuenta y se congela" y no un loop?

Un GIF no puede tener un frame por cada segundo de varios días (serían cientos de
miles de frames / cientos de MB). Es el método estándar de los countdown-GIF de
email: el GIF muestra los próximos N segundos ticando y se congela; al regenerarlo
seguido siempre está al día. Si falta menos que la ventana, llega a `00` y muestra
el texto de expirado.

El **reloj de la página se controla desde el pipeline** (override de `Date`), así
los 600 frames se generan en ~25s **sin esperar 10 min reales** — y sin tocar
`countdown.html`: es el mismo HTML/CSS/JS final.

## Formato del JSON (`programmed-timers/*.json`)

```json
{
  "name": "cyber-2026",
  "target": "2026-06-01T00:00:00-04:00",
  "expired_text": "¡EL CYBER YA COMENZÓ!",
  "colors": {
    "bg": "#0a0a0a", "box_fill": "#1a0a2e", "box_border": "#7b2fff",
    "color_number": "#ffffff", "color_label": "#7b2fff",
    "color_separator": "#7b2fff", "color_accent": "#00f0ff"
  },
  "gif": { "width": 700, "height": 220, "scale": 1, "durationSeconds": 600 }
}
```

- `name` → nombre del archivo de salida (`gifs/<name>.gif`).
- `target` / `expired_text` / `colors` → los mismos params que entiende `countdown.html`.
- `gif.durationSeconds` → largo del conteo (1 frame/seg). `600` = 10 min. Tope: 3600.
- `gif.scale` → `2` para un GIF nítido/retina (pesa ~4×).

**Tamaños reales** (700×220, scale 1): 5 min ≈ 2.4 MB · 10 min ≈ 4.8 MB. El glow
neón de las cajas es lo que más pesa; bajá `width/height` o el glow si necesitás
un GIF más liviano para email.

## Correr el pipeline localmente

Requisitos: Node 18+ y Chrome/Chromium (autodetecta `/usr/bin/google-chrome`,
o definí `CHROME_PATH`).

```bash
cd pipeline
npm install

# Renderizar todos los timers una vez:
npm run once

# Renderizar un timer puntual:
node render.js ../programmed-timers/cyber-2026.json

# Daemon: re-renderiza en loop (default cada 5 min), Ctrl+C para salir:
npm run watch                 # INTERVAL_MS=300000 por defecto
INTERVAL_MS=60000 npm run watch   # cada 1 min = menos staleness
```

Cada render tarda ~25s con 600 frames, así que no tiene sentido bajar
`INTERVAL_MS` de ~60s.

## GitHub Action (regenera y commitea solo)

`.github/workflows/update-gifs.yml` corre en CI, regenera `gifs/*.gif` y los
commitea al repo. Se dispara por:

- **`schedule`**: cada 5 minutos.
- **`workflow_dispatch`**: botón manual "Run workflow".
- **`push`**: al cambiar `programmed-timers/`, `countdown.html` o `pipeline/`
  (regeneración inmediata).

Necesita permiso de escritura (ya declarado: `permissions: contents: write`).

### ⚠️ Frecuencia: el `cron` de Actions es de 5 min mínimo

GitHub Actions **no baja de 5 minutos** en `cron`, y además los schedules pueden
retrasarse o saltarse si los runners están cargados. Por eso el workflow usa
`*/5 * * * *`. Como el GIF dura **10 min** contando hacia abajo, aguanta un atraso
de la corrida siguiente sin quedar congelado: cuando alguien lo abre, sigue ticando.

Si querés menos staleness todavía, corré el daemon en un servidor propio (VPS,
Raspberry, systemd/pm2) con un `INTERVAL_MS` más chico:

```bash
cd pipeline && INTERVAL_MS=60000 node pipeline.js   # regenera cada 1 min
```

## Embeber el GIF

```html
<img src="https://<tu-repo>/raw/main/gifs/cyber-2026.gif" alt="Countdown" width="700">
```
