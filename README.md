# arhant.github.io

Personal portfolio: [arhant.github.io](https://arhant.github.io/)

## What it is
A space-themed portfolio for Arhant Jain, Senior Software Engineer and Tech Lead. Scrolling flies a camera through a
cinematic, procedurally rendered 3D scene. Each section has its own set-piece, and the content sits on top in
mission-control style panels.

## Tech
- Vanilla HTML/CSS/JS with no build step, hosted on GitHub Pages
- Three.js r170, vendored in `js/vendor/three/` and loaded through an import map
- Everything in the scene is procedural: baked on the GPU at load or shaded live, with no image assets
- HDR rendering with bloom, ACES tone mapping and a final pass that dims the scene behind text for readability

## Space journey
The camera follows a spline anchored to each section's position on the page, so the scene always lines up with the
content. The sky is shared by every section: a baked Milky Way with distant galaxies, globular clusters and two
Magellanic-style dwarf galaxies, plus the occasional meteor.

| Section | Set-piece | Highlights |
|---|---|---|
| Hero | Earth at sunrise | Analytic Rayleigh/Mie atmosphere, ocean glint, city lights, clouds, aurora, the Moon, a space station, lens flare |
| About | Emission nebula + comet | Ray-marched volume and dust; comet with a straight ion tail and a curved dust tail |
| Experience | Ringed gas giant | Differential band rotation, ring↔planet shadows, backlit rings, instanced moonlets, a hazy moon and an icy moon |
| Skills | Blue-white star | Granulation, sunspots, limb darkening, corona streamers, prominences, a red-dwarf companion, a transiting planet |
| Case Studies | Spiral galaxy | Log-spiral arms and dust lanes, star points, Doppler-beamed jets, globular clusters, dwarf satellites, a ring nebula |
| Contact | Black hole | Schwarzschild ray tracing that lenses the Milky Way; accretion disk with Doppler beaming |

### Motion and quality
- **Lite mode** (the toggle in the nav, or `prefers-reduced-motion` / Save-Data): no 3D at all; Three.js is never
  downloaded. A static CSS starfield is shown instead.
- **Quality tiers** (high, medium, low) are picked from the GPU and then confirmed by a short frame-time probe. If
  frames keep dropping, a runtime governor lowers the resolution, then the tier, and finally falls back to the static
  backdrop.
- **Software rendering, no WebGL2, or a blocked script** all fall back to the static backdrop, and the page stays fully
  usable.
- **`?quality=high|medium|low`** forces a tier, which is useful for testing.
- **Warp:** scrolling fast streaks the stars and dims the content. Under reduced motion this is disabled.
- **Event horizon:** keep scrolling at the very bottom of the page and the camera free-falls into the black hole on
  autopilot. The observer is a "raindrop" falling from rest at infinity (speed sqrt(rs/r) relative to static
  observers). The tracer applies the matching aberration and Doppler shift, so the shadow, the photon ring and the
  outside universe change the way they would for a real infall, including past the horizon. Any click, key press,
  upward scroll or touch flies you back out.
- **Command palette:** `Ctrl K` (or `⌘K`).

## Structure
```
├── index.html                 all content (static HTML), inline SVG icon sprite, import map
├── 404.html                   "Lost in space"
├── css/style.css              tokens, layout, components, motion (all animation gated on data-motion="full")
├── js/main.js                 UI controller; publishes window.Journey + space:* events
├── js/palette.js              command palette (lazy)
├── js/space/
│   ├── boot.js                feature checks, tier guess, fallback (no static imports)
│   ├── app.js                 renderer, lifecycle, probe/governor, set-piece manager, frame loop
│   ├── camera-rig.js          section-anchored camera, warp, parallax
│   ├── plunge.js              event-horizon dive: free-fall schedule, auto-exposure, hand-back to the rig
│   ├── path-data.js           set-piece origins, camera keyframes, per-section grade
│   ├── post.js                composer: render → bloom → final pass
│   ├── readability.js         rects of [data-readable] blocks for the final pass
│   ├── quality.js             tiers + governor
│   ├── setpieces/             sky, stars, earth, nebula, gas-giant, star, galaxy, black-hole
│   ├── shaders/               shared GLSL (noise, blackbody, final pass)
│   └── lib/                   GPU bakes, colour, math, glow sprite
├── js/vendor/three/           Three.js r170 + post-processing addons (MIT)
├── img/                       avatar in AVIF/WebP/JPEG at 320/480 px
└── .github/workflows/deploy.yml
```

The UI and the scene talk through `window` CustomEvents:

| Direction | Events |
|---|---|
| UI → scene | `space:section`, `space:warp`, `space:motion`, `space:focus` |
| Scene → UI | `space:ready`, `space:tier`, `space:fallback` |

## Run locally
ES modules and import maps need a real HTTP server; opening the file directly won't work.
```
python -m http.server 8000
```
Then open http://localhost:8000. Google Analytics stays off locally.

## Deploy
Pushing to `main` (or `master`) runs `.github/workflows/deploy.yml`. The workflow writes the Google Analytics ID into
`index.html` and publishes the site to GitHub Pages.

One-time setup:
1. **Settings → Secrets and variables → Actions → New repository secret:** `GA_MEASUREMENT_ID` = your GA4 measurement
   ID (`G-…`).
2. **Settings → Pages → Build and deployment → Source:** **GitHub Actions**.

Without the secret, the site still deploys; it just has no analytics.

## Editing content
- All copy lives in `index.html`. Sections are the `<section data-scene="…">` elements inside `<main>`.
- Hero numbers are `data-count` readouts. The final value is written in the HTML; JavaScript only animates up to it.
- Archive project links currently point to the GitHub profile. Replace them with repo URLs (look for the `TODO` in
  `index.html`).

## Credits
- [Three.js](https://threejs.org/) (MIT)
- Icons: [Font Awesome Free](https://fontawesome.com/) 6.5.1 (CC BY 4.0)
- 3D simplex noise: Stefan Gustavson and Ashima Arts (MIT)
- Hash without sine: Dave Hoskins (MIT)
