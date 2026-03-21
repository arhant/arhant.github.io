# arhant.github.io

Personal portfolio — [arhant.github.io](https://arhant.github.io/)

## What it is
Space-themed portfolio for Arhant Jain — Tech Lead & Sr Software Engineer. Scrolling flies you through a physics-based 3D space scene. Content floats as translucent glass cards over the journey.

## Tech
- Vanilla HTML/CSS/JS — no frameworks
- Three.js with sprite textures (no squares, only soft glow particles)
- Physics-based rendering: blackbody star colors, logarithmic spiral arms, Sedov-Taylor shockwaves, Keplerian accretion disks
- Hosted on GitHub Pages

## Space Journey
Scroll = fly through space. Each section passes through a different region:

| Zone | Section | What you see |
|------|---------|-------------|
| 1 | Hero | Open star field, pulsars, constellations |
| 2 | About | Emission nebulae, dust lanes, planetary nebula |
| 3 | Experience | Spiral galaxies, quasar, star clusters |
| 4 | Skills | Supernovae, black hole with accretion disk, asteroid belt |
| 5 | Projects | Crab Nebula, deep nebulae, distant galaxy |
| 6 | Contact | Grand finale — black hole, quasar, supernova |

### Objects
- **Stars** — blackbody-colored by temperature (3000K red dwarfs to 30000K blue giants)
- **Spiral galaxies** — logarithmic spiral arms, core-to-edge color gradient
- **Black holes** — accretion disk (blackbody gradient), ISCO photon ring, Einstein ring, relativistic jets, dark event horizon
- **Supernovae** — Sedov-Taylor shockwave shell, Rayleigh-Taylor filaments, hot ejecta
- **Pulsars** — rotating neutron star with lighthouse beams that pulse as they sweep
- **Quasars** — hyper-luminous core, broad/narrow emission lines, enormous jets
- **Crab Nebula** — synchrotron glow, 22 H-alpha filaments, O III emission, central pulsar
- **Planetary nebulae** — toroidal ring + bipolar lobes + white dwarf
- **Spaceships** — white head + cyan-to-blue plasma exhaust trail
- **Shooting stars** — blackbody-colored streaks

### Easter egg
Scroll fast → all UI fades out → pure space journey with widened FOV and brighter stars. Stop scrolling → content fades back in.

## Structure
```
├── index.html
├── css/style.css
├── js/main.js       (nav, animations, interactions)
├── js/space.js      (Three.js physics-based space scene)
├── arhant-jain.jpg
└── favicon.png
```

## Run locally
```
python3 -m http.server
```
