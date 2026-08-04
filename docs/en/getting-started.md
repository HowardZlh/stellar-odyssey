# Getting Started

> 中文原版 / Chinese original: [../getting-started.md](../getting-started.md)

> Stellar Odyssey -- a scroll-wheel journey from a planet's surface to the edge of the universe.
> This guide walks you through installation and suggests a route for your first voyage.

## Requirements

- Node.js 20+ and npm
- A modern browser with WebGL 2 support (Chrome / Edge recommended; Firefox / Safari also work)
- Target memory footprint < 1GB; no dedicated GPU required (runs smoothly on integrated graphics)

## Install and Run

```bash
# Install dependencies after cloning the repo
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to enter.

Production deployment:

```bash
npm run build
npm run start
```

## The Interface in 30 Seconds

When the app loads you will see:

| Area | Contents |
|---|---|
| **Top left · Control panel** | View level switching / simulation speed / sound / display toggles / dynamic event demos (options show or hide intelligently based on the current view level) |
| **Top right · HUD** | Current view level, simulation time, scale ruler, reference frame, follow status, galactic year progress (L3) |
| **Bottom right · Info panel** | After selecting a body: name, type, real physical parameters and data sources, with "Fly to / Follow" buttons |
| **Bottom · Onboarding guide** | First-visit shortcut hints and scientific-accuracy notes (dismissible) |

## Your First Voyage: Recommended Route (about 5 minutes)

1. **Start from Earth** -- the app opens in the Planet view (L1), following Earth. Drag to look around: continents, oceans, cloud layers, and city lights on the night side; press `]` to tour the Earth system: Tiangong space station → ISS → Hubble → geostationary satellites → the Moon.
2. **Zoom out to the Solar System** -- press `2` or simply scroll out. The eight planets move along real Keplerian orbits (planet positions match the actual current date). Drag the speed slider to accelerate time and watch Mercury race around and Halley's Comet whip past perihelion.
3. **Fly to the Sun** -- click the Sun → hit "Fly to" in the info panel for a close-up of granulation and sunspots; check **Solar interior cutaway** in the control panel to explore the core / radiative zone / convective zone layers; click "Trigger solar flare demo" to watch a flare.
4. **Leap into the Milky Way** -- press `3`. Your solar system is now just a tiny dot marked "You are here." Press `G` to switch to the galactocentric frame and watch the solar system ride its wavy orbit around the galactic center from above; press `V` for vertical expansion, morphing the galactic disk into an ellipsoid to see the true galactic-latitude distribution of notable objects; press `]` to tour 14 deep-space stops.
5. **Zoom in on a black hole** -- after touring to Sagittarius A*, **keep scrolling in**: the background starfield starts to bend, and the photon ring and Doppler-brightened accretion disk emerge -- real-time raymarched gravitational lensing. Then head to the Orion Nebula stop and zoom in to dive inside the volume-rendered, scallop-shaped emission cavity and see the Trapezium cluster.
6. **Reach the edge of the universe** -- press `4` to take in the whole Local Group (against a point cloud of 43,488 real galaxies from the 2MASS redshift survey). Fly to M31, the Andromeda Galaxy, for a close-up of its photo-driven spiral arms and dust lanes; click "⏩ Preview the Milky Way–Andromeda collision" for a 12-second, 4.5-billion-year fast-forward as the two galaxies merge into Milkomeda; then fly to M87 and zoom in on its core to recreate the photon ring from the EHT's first black hole image; keep scrolling out, past the Virgo Cluster and the Laniakea Supercluster, all the way to the edge of the observable universe.
7. **One continuous shot home** -- from the edge of the universe, keep scrolling in without a single click, all the way back down to Earth's surface -- that is the continuous cross-scale zoom voyage.

## Quick Shortcut Reference

| Key | Function |
|---|---|
| `1` `2` `3` `4` | Switch to Planet / Solar System / Milky Way / Universe view |
| Scroll wheel | Continuous zoom (seamless voyage across view levels) |
| Drag / right-drag | Rotate / pan |
| `Space` | Pause / resume |
| `[` / `]` | Tour to previous / next body (scoped to the current view level) |
| `F` / `Esc` | Fly to selected body / stop following |
| `O` / `L` / `M` / `R` | Orbit lines / labels / sound / true scale |
| `G` / `V` | Galactocentric frame / vertical expansion (both Milky Way view only) |
| `H` | Hide / show the entire UI |

See [controls.md](controls.md) for the full reference.

## Next Steps

- Want to know what each view level has to offer? → [Four-view tour guide](view-guide.md)
- Want to trigger supernovae and galaxy mergers? → [Dynamic event demos](events-guide.md)
- Want to share a deep link to a specific body, or deploy an auto-touring exhibit? → [Launch URL parameters](launch-params.md)
- Want to know what is real data and what is registered as artistic design? → [Science notes](science-notes.md)
- Curious how rendering across 10+ orders of magnitude works? → [How it works](how-it-works.md)
- Want to contribute? → [Development guide](development.md)

## FAQ

**Q: Why are the planets so small / invisible when I open the app?**
In the default mode, body sizes are logarithmically compressed and exaggerated to stay visible. If true-scale mode (`R`) is on, planets being nearly invisible at solar-system scale is a scientific fact -- select one and use "Fly to" for a close-up.

**Q: Why is there sound in space?**
Space is silent; the audio is registered as artistic design (noted in the app). Press `M` to mute or adjust the volume in the panel.

**Q: Frame rate below 60 FPS?**
Volume rendering (nebulae / black holes / dust disks) has built-in adaptive quality scaling (it automatically lowers step counts and render resolution). If that is not enough, turn off "Bloom" in the control panel and enable "Performance monitor" to watch FPS/memory.

**Q: Port already in use?**
Use the alternate scripts `npm run dev:3100` or `npm run dev:3200` (each uses its own build directory and can run alongside the port-3000 instance). Note that Next.js places a mutex lock on the build directory, so simply switching ports with `next dev -p <port>` will be refused.

**Q: Does it work on phones/tablets?**
Basic browsing works: one-finger rotate, two-finger pinch zoom, and tap-to-select are all available. However, the layout and performance target desktop browsers and large exhibition screens; it is not optimized for mobile.
