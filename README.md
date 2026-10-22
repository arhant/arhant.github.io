# arhant.github.io

Personal portfolio: [arhant.github.io](https://arhant.github.io/)

## What it is
A space-themed portfolio for Arhant Jain, Senior Software Engineer and Tech Lead. Scrolling flies a camera through a
cinematic, procedurally rendered 3D scene. Each section has its own set-piece, and the content sits on top in
mission-control style panels.

## Tech
- Vanilla HTML/CSS/JS with no build step, hosted on GitHub Pages
- Three.js r170, vendored in `js/vendor/three/` and loaded through an import map
- Everything in the scene is procedural: baked on the GPU at load or shaded live, with no image assets. The only
  scene images are poster stills captured from the scene itself (`img/scene/`)
- HDR rendering with bloom, ACES tone mapping and a final pass that dims the scene behind text for readability
- Self-hosted fonts (Inter, Space Grotesk, JetBrains Mono; variable woff2, Latin subset) with metric-matched local
  fallback faces, so the text doesn't reflow when they arrive. No Google Fonts
- Line icons from Lucide; the GitHub, LinkedIn and YouTube marks are Font Awesome brand icons

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
  downloaded. Still frames of the scene, captured ahead of time, are shown over a static CSS starfield instead.
- **Poster frame:** the hero shows a still of the real scene from first paint, and the live 3D fades in over it. A deep
  link (or Back) to another section shows that section's still until the 3D is up.
- **Quality tiers** (high, medium, low) are picked from the GPU and then confirmed by a short frame-time probe. If
  frames keep dropping, a runtime governor lowers the resolution, then the tier, and finally falls back to the static
  backdrop. A display that lowers its own refresh rate (such as iOS Low Power Mode) is recognised as such and costs no
  quality.
- **Software rendering, no WebGL2, or a blocked script** all fall back to the static backdrop, and the page stays fully
  usable.
- **Warp:** scrolling fast streaks the stars and pushes the camera. The text stays readable (it dims to 85% at most
  and the readability mask stays on), and on touch screens only the scene reacts. Lite mode has no warp.
- **Event horizon:** at the very bottom of the page, "Cross the event horizon" (or a fresh downward scroll, or the
  command palette) sends the camera into a free fall into the black hole on autopilot, about 25 seconds long. The
  observer is a "raindrop" falling from rest at infinity (speed sqrt(rs/r) relative to static observers). The tracer
  applies the matching aberration and Doppler shift, so the shadow, the photon ring and the outside universe change
  the way they would for a real infall, including past the horizon. Escape, or any click, key press, upward scroll
  or touch, flies you back out.
- **Command palette:** `Ctrl K` (or `⌘K`), or `/`. Besides jumping to sections and case studies, it can start the
  plunge, show and change the graphics quality (tier, fps and resolution), and, with a mouse or trackpad, "look
  around the scene" (the page hides while the pointer or arrow keys turn the camera; Escape or "Back to reading"
  returns).

### URL flags
| Flag | Effect |
|---|---|
| `?quality=high\|medium\|low` | Forces a tier and skips the software-GPU check. Useful for testing. The palette's quality choice does the same and is remembered on this device ("Auto" clears it). |
| `?poster=<s>[&t=<seconds>]` | Poster mode: renders one still of section-space position `s` (0 is the hero, 5.75 the black hole) at the high tier, DPR 1, with an exact, still camera and no readability mask. When every set piece in range is ready, it sets `window.__poster` to a PNG data URL and emits `space:poster`. Used to capture `img/scene/`: set `localStorage.motion = 'full'` before loading (the scene only boots in full motion) and size the window to the still you want (2520×1080 wide, 900×2000 tall); the device pixel ratio doesn't matter. |
| `?tm=agx\|neutral`, `?knee=0..1` | Grading experiments, never defaults: swap the ACES tone-map operator, or give the bloom threshold a soft knee. The set pieces are graded for ACES. |

## Pages
- `/`: the portfolio.
- `/work/spec-driven-development/`, `/work/message-level-encryption/`, `/work/credit-application-apis/`: case-study
  pages. Calm reading layout, no 3D (only the static backdrop). "Read the case study" on a homepage card morphs the
  card title into the page header with a cross-document View Transition; lite mode and reduced motion skip it.
- `/black-hole/`: what you would actually see falling into a black hole, with a still captured from the scene.
  Linked from Contact.
- `404.html`: "Lost in space".

The standalone pages share `css/page.css`, `js/page.js` and the `img/icons.svg` sprite, and use root-absolute URLs.
They repeat the HUD (logo, nav, motion toggle) and the footer from `index.html` by hand, so when that shared markup
changes, update every copy: `404.html`, `work/*/index.html` and `black-hole/index.html`.

## Structure
```
├── index.html                 the portfolio: all content (static HTML), inline SVG icon sprite, import map
├── 404.html                   "Lost in space"
├── work/<slug>/index.html     case-study pages
├── black-hole/index.html      the black-hole explainer
├── css/style.css              tokens, layout, components, motion (all animation gated on data-motion="full")
├── css/page.css               standalone pages: reading layout, cross-document view transitions
├── js/main.js                 UI controller; publishes window.Journey + space:* events; analytics
├── js/page.js                 standalone pages: motion toggle, copy email, view transitions off in lite mode
├── js/palette.js              command palette (lazy)
├── js/space/
│   ├── boot.js                feature checks, URL flags, fallback (no static imports); preloads the scene once the GPU check passes
│   ├── app.js                 renderer, lifecycle, probe/governor, set-piece manager, frame loop, poster mode
│   ├── events.js              the UI ↔ scene event names
│   ├── camera-rig.js          section-anchored camera, warp, parallax, free look
│   ├── plunge.js              event-horizon dive: free-fall schedule, auto-exposure, hand-back to the rig
│   ├── path-data.js           set-piece origins, camera keyframes, per-section grade
│   ├── post.js                composer: render → bloom → glass blur (Contact only) → final pass
│   ├── glass.js               dual-Kawase blur for the frosted-glass Contact panel
│   ├── readability.js         rects of [data-readable] blocks for the final pass
│   ├── quality.js             tiers, governor, saved tier
│   ├── setpieces/             sky, stars, earth, nebula, comet, gas-giant, star, galaxy, black-hole, registry
│   ├── shaders/               shared GLSL (noise, blackbody, final pass)
│   └── lib/                   GPU bakes, colour, math, glow sprite
├── js/vendor/three/           Three.js r170 + post-processing addons (MIT)
├── js/vendor/web-vitals/      web-vitals 4.2.4 (Apache-2.0), loaded only when Google Analytics is on
├── fonts/                     Inter, Space Grotesk, JetBrains Mono (woff2) + OFL.txt
├── img/                       avatar (320/480 px) and About portrait (480/720/960 px) in AVIF/WebP/JPEG;
│                              icons.svg sprite for the standalone pages
├── img/scene/                 poster stills captured from the scene (hero, lite-mode sections, black hole)
├── tools/capture_posters.py   re-captures img/scene/ with ?poster
└── .github/
    ├── workflows/ci.yml       checks (see below)
    ├── workflows/deploy.yml   checks, then GitHub Pages deploy
    └── scripts/               a11y.py (axe-core through Playwright), lighthouserc.yml
```

The UI and the scene talk through `window` CustomEvents (names and payloads in `js/space/events.js`):

| Direction | Events |
|---|---|
| UI → scene | `space:section`, `space:warp`, `space:motion`, `space:focus`, `space:plunge`, `space:look` |
| Scene → UI | `space:ready`, `space:tier`, `space:fallback`, `space:plunge-state`, `space:plunge-end`, `space:plunge-done`, `space:poster` |

## Run locally
ES modules and import maps need a real HTTP server; opening the file directly won't work.
```
python -m http.server 8000
```
Then open http://localhost:8000. Google Analytics stays off locally.

## Checks
`.github/workflows/ci.yml` runs on pull requests, on manual runs, weekly, and from `deploy.yml` before every deploy.

| Check | Blocks deploy | What it does |
|---|---|---|
| Internal links and anchors | Yes | lychee, offline, over every page: relative and root-absolute links must exist and every `#fragment` must match an id |
| Accessibility | Yes | `.github/scripts/a11y.py` loads each page at 1440×900 and 390×844, in lite and full motion, runs axe-core 4.10.2 and fails on serious or critical violations |
| Lighthouse | No (warn-only) | Mobile, median of 3 runs. Budgets: LCP < 2.5 s, CLS < 0.05, accessibility ≥ 0.95, under 60 KB of script transfer. It measures the **static fallback** only: headless Chrome renders WebGL in software, so the 3D never loads there |
| External links | No (weekly) | lychee against the live web, Mondays (or a manual run with "external_links"). LinkedIn and `mailto:` are skipped |

`ci.yml` has no push trigger, so a push runs the checks once, inside the deploy. To run the accessibility check
locally (Python with `pip install playwright` and `python -m playwright install chromium`):
```
python .github/scripts/a11y.py                                         # serves the repo itself
python .github/scripts/a11y.py --base-url http://127.0.0.1:8000 --channel chrome
```

## Deploy
Pushing to `main` (or `master`) runs `.github/workflows/deploy.yml`. It runs the checks above first and only deploys
if the blocking ones pass. Then it writes the Google Analytics ID into every page that carries the snippet (`index.html`,
`work/*/index.html`, `black-hole/index.html`) and publishes the site to GitHub Pages.

One-time setup:
1. **Settings → Secrets and variables → Actions → New repository secret:** `GA_MEASUREMENT_ID` = your GA4 measurement
   ID (`G-…`).
2. **Settings → Pages → Build and deployment → Source:** **GitHub Actions**.

Without the secret, the site still deploys; it just has no analytics.

### Google Analytics (GA4)
The site sends no personal data. Besides the standard page view it sends `LCP`, `INP` and `CLS` once per page
(event value in ms; CLS × 1000), `scene_ready`, `tier_change`, `scene_fallback`, `max_section_reached`,
`contact_click` and `event_horizon`. GA only loads on the deployed site, so local and CI runs send nothing. In GA4
(manual, one time):
1. **Admin → Custom definitions → Create custom dimension** (event scope) for the parameters `motion`, `tier`,
   `reason`, `section` and `metric_rating`. Optionally also `post`, `from`, `to`, `method` and `action`, and a custom
   metric `probe_ms` (milliseconds).
2. **Admin → Data collection and modification → Data collection:** turn off Google signals and ads personalization,
   and don't link Google Ads.

## Release checklist
CI can't see the live 3D path. Before a release that touches the scene, the motion code or the CSS, check by hand:
- `?quality=high`, `?quality=medium` and `?quality=low`: each tier boots and the text stays readable over every
  set piece.
- A mid-range Android phone with throttling: the scene arrives, scrolling stays smooth, no fallback.
- An Iris Xe-class laptop: frame rate holds (the palette shows fps), no fallback.
- A 120 Hz trackpad: fast flicks streak the stars without blanking the text; no stutter.
- iOS Safari, including the LinkedIn in-app browser: the right tier, no lost context, the lite toggle, and the view
  transition into a case study.
- After any change to `js/space/path-data.js`, the camera rig or a set piece, re-capture the poster stills and commit
  `img/scene/`. The CSS shows the wide stills at full height on landscape screens and the tall ones at full width when
  the aspect ratio is 3:4 or narrower, so frame the subject for that:
  ```
  python tools/capture_posters.py
  ```

## Editing content
- All homepage copy lives in `index.html`. Sections are the `<section data-scene="…">` elements inside `<main>`.
- Hero readout values are written in the HTML.
- Archive projects link to their public repos (Gaming Culture has none, so it stays plain text).
- Case studies with their own page are under `work/`; keep the homepage card and the page in step.

## License
Copyright (c) 2026 Arhant Jain. All rights reserved. The code, design, text and images here may not be copied, reused
or republished without written permission; see [LICENSE](LICENSE). Third-party components keep their own licenses;
see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Credits
- [Three.js](https://threejs.org/) (MIT)
- Fonts: [Inter](https://github.com/rsms/inter), [Space Grotesk](https://github.com/floriankarsten/space-grotesk) and
  [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (SIL OFL 1.1), via [Fontsource](https://fontsource.org)
- Icons: [Lucide](https://lucide.dev/) 0.460.0 (ISC; portions from Feather, MIT); brand icons from
  [Font Awesome Free](https://fontawesome.com/) 6.5.1 (CC BY 4.0)
- [web-vitals](https://github.com/GoogleChrome/web-vitals) 4.2.4 (Apache-2.0)
- 3D simplex noise: Stefan Gustavson and Ashima Arts (MIT)
- Hash without sine: Dave Hoskins (MIT)
- CI only, not shipped: [axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0),
  [lychee](https://github.com/lycheeverse/lychee), [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
