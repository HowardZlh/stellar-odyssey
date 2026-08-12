# Four View Levels: A Guided Tour

> 中文原版 / Chinese original: [../view-guide.md](../view-guide.md)

The world of Stellar Odyssey is organized into four view levels. Jump straight to any of them with keys `1`–`4`, or scroll the mouse wheel for a seamless continuous zoom across all of them.
Each view level has its own content, time-compression ratio, soundscape, and control-panel options.

```
L1 Planet ──scroll──> L2 Solar System ──scroll──> L3 Milky Way ──scroll──> L4 Universe
   ~planet scale         ~50 AU                     ~100k light-years        ~hundreds of Mly
```

> Note: the L3/L4 tour sequences (`[` / `]`) and close-view detail layers (photon rings, volumetric
> nebula interiors, galaxy close-up particles, etc.) are time-limited supporter unlocks — the free
> experience still shows every object from afar with full info-panel science notes, and L1/L2 remain
> fully unrestricted. See [Supporter Unlock](unlock-guide.md) for scope, tiers, and redemption.

---

## L1 · Planet View 🌍

**What to see**

- Planetary surface detail: Earth's continents, oceans, clouds, and city lights on the night side; Mars' polar caps and Valles Marineris; Jupiter's cloud bands and the differentially shearing Great Red Spot; Saturn's rings and the Cassini Division… every planet carries 4K textures plus normal maps for close-up relief
- Satellite systems: the Moon (tidally locked, always showing the same face to Earth), the ISS / Hubble / geostationary satellites / Tiangong (detailed glTF models up close, with nadir-pointing attitude and sun-tracking solar panels), the 1:2:4 resonance of the Galilean moons, Titan and Enceladus
- Twinkling star background (this view only — stars do not twinkle in vacuum; twinkling comes from atmospheric turbulence and is a registered artistic liberty)

**How to play**

- `]` / `[` cycles **within the current planetary system** (e.g. the Earth system's 6 stops: Earth → Tiangong → ISS → Hubble → geostationary satellite → Moon; while following Jupiter you cycle among the Galilean moons)
- Enable **satellite orbit lines** in the panel (an option exclusive to this view)
- Trigger the **solar flare / CME demo** (shared with L2)
- Turn on true scale mode (`R`) to appreciate just how tiny satellites really are

---

## L2 · Solar System View ☀️

**What to see**

- The eight planets + dwarf planets (Pluto / Ceres / Eris / Makemake / Haumea) + comets (Halley / Encke) moving along true Keplerian orbits, with initial positions matching the real current date
- The asteroid belt (2.2–3.2 AU) and the Kuiper belt: every particle follows its own Keplerian orbit — inner rings run fast and outer rings run slow (Keplerian shear)
- Solar activity: sunspots (migrating with the 11-year butterfly diagram), prominences, faculae, differential rotation; a schematic outer boundary of the Oort cloud; the three-layer heliopause structure (termination shock / heliosheath) with Voyager 1/2 markers
- Halley's comet growing a coma and twin tails near perihelion (blue ion tail + yellow-white dust tail, always pointing away from the Sun)

**How to play**

- `]` / `[` tours the 15 bodies (planets + dwarf planets + comets) in ascending order of orbital semi-major axis
- Click the Sun → check **solar interior cutaway** in the panel (exclusive to this view): a quarter-cutaway showing the core / radiative zone / convective zone, each clickable for explanations
- Trigger the **solar flare / CME demo**; when a CME heads toward Earth you can watch the auroral enhancement after it arrives
- Speed up time to watch planetary revolutions and Halley's 76-year period

---

## L3 · Milky Way View 🌀

**What to see**

- 3D barred-spiral structure: bulge + a 43,000-particle galactic disk + density-wave spiral arms (the arm pattern rotates out of step with the stars' differential rotation) + dust lanes + galactic halo + **HI warp** (an S-shaped vertical warp in the outer disk, visible edge-on) + **Fermi bubbles** (bipolar glow above and below the galactic center, toggleable)
- The Solar System's location and motion: a "You are here" marker (about 26,000 light-years from the galactic center), riding a wavy orbit around the center (vertical oscillation visually amplified ×10, registered), with the HUD tracking galactic-year progress (one lap ≈ 230 million years)
- A 14-stop deep-space tour of objects (real prototypes + SIMBAD galactic-latitude placement), **every stop rewards flying in and zooming close**:
  - **Volume-rendered nebulae** (raymarched emission–absorption): the Orion Nebula M42 (scalloped emission cavity + the Trapezium-carved hollow, in two colors — Hα red and OIII teal), the Ring Nebula M57 shell, the Horsehead Nebula's dark absorption silhouette, the Crab Nebula's filamentary remnant plus pulsar wind torus and polar jets, and the WR 124 wind-blown ejecta shell
  - **Gravitationally lensed black holes**: Sagittarius A* and Cygnus X-1 — zoom in to see the photon ring, warped background starfield, accretion-disk blackbody colors with Doppler beaming brightening and gravitational redshift
  - **Physically modeled stellar surfaces**: Betelgeuse (orange-red blackbody color + asymmetric giant convection cells + diffraction spikes), Rigel / Sirius A (blue-white), the white dwarf Sirius B, the pulsating Cepheid δ Cephei — colors set by the Planck blackbody spectrum, with limb darkening binned by spectral type
  - **Real-catalog star clusters**: the Pleiades (600 genuine member stars selected from Gaia DR3 parallax + proper motion, plus the blue reflection nebula) and the globular cluster M13 (King profile + HR-diagram colors)

**How to play**

- `]` / `[` tours the 14 stops (heliopause → Sagittarius A* → Betelgeuse → … → Pleiades → M13), flying to each in turn; **keep scrolling in after following** to unlock close-up detail layers like photon rings and volumetric nebula interiors
- `G` toggles the **galactocentric frame** (a panel section exclusive to this view): the galactic center stays fixed while you watch the Solar System ride its wavy orbit around it, with a stationary galactic-year scale sliding past the origin
- `V` toggles **vertical expansion** (exclusive to this view): the entire galactic disk morphs into a flattened spheroid, special objects spread out to their true galactic-latitude heights with altitude indicator lines; a gain slider adjusts ×1–×6
- Trigger the **supernova demo** (exclusive to this view): a complete four-stage explosion animation that leaves behind a permanent remnant (neutron star or black hole)

---

## L4 · Universe View 🌌

**What to see**

- The Local Group: the Milky Way (Fermi bubbles + HI warp remain visible), Andromeda M31 (with companions M32/M110), Triangulum M33, the Large and Small Magellanic Clouds (moving along their orbits + the Magellanic Stream), and the Sagittarius dwarf galaxy (tidal tails + the Sagittarius tidal stream)
- **Imagery-driven galaxy close-ups**: fly to M31 / M33 / the LMC and SMC and the wide-shot photo billboard cross-fades into a 3D particle cloud — spiral-arm geometry, dark dust lanes, and star-forming regions are all baked from real DSS2 survey imagery, matching the photographs feature for feature; viewing M31 at an angle, the near-side **volumetric dust disk genuinely occludes** the starlight behind it (line-of-sight extinction); zoom into the LMC to spot **30 Doradus, the Tarantula Nebula** (pink Hα emission region + the bright R136 core) and the yellowish central bar
- **Real survey background (2MRS)**: a 3D point cloud of 43,488 real galaxies replaces the schematic cosmic web — the galaxy concentration toward the Virgo Cluster, the zone of avoidance, and filamentary large-scale structure are all real data (toggleable, with three documented distortions)
- The Milky Way and Andromeda approaching each other at ~110 km/s (connecting trajectory + flowing light dots + a collision countdown of about 4.5 billion years)
- Larger scales: **M87** at the heart of the Virgo Cluster (spheroidal starlight + 2,000 globular clusters + an HST-1-knot-style jet + surrounding Virgo members; **keep zooming into the core to reveal the near-face-on photon ring in the style of EHT 2019**), the quasar 3C 273 (accretion disk + dusty torus close-up), the Antennae Galaxies (N-body tidal tails up close), Abell 370-style lensing arcs (screen-space lens distortion of the background while following), **GRB 221009A** (relativistic twin jets + expanding afterglow shell on a repeating cycle), the Laniakea supercluster boundary and the direction of the Great Attractor, and the observable-universe boundary shells (radius ≈ 46.5 billion light-years)
- Schematic Hubble expansion: the point cloud and cosmic web rescale over time, with distant galaxies reddening from redshift

**How to play**

- `]` / `[` tours the 8 galaxy stops (Milky Way → LMC and SMC → Sagittarius dwarf → M31 → M33 → M87 → 3C 273); after flying to each stop, **keep scrolling in** to see the close-up detail layers (zooming into M87's core triggers the EHT photon ring)
- Trigger the **merger preview** (exclusive to this view): ⏩ fast-forwards 4.5 billion years in 12 seconds, showing the full Milky Way–Andromeda sequence of first passage → oscillating rebounds → tidal distortion → starburst → the final elliptical galaxy Milkomeda; one click on ⏪ restores the pre-preview time
- Panel checkboxes for **real survey background (2MRS)** / **Fermi bubbles** / **velocity vector arrows** (domain-exclusive toggles)
- `O` toggles satellite-galaxy orbit lines; speed up time to watch the Magellanic Clouds orbit the Milky Way

---

## Cross-View Mechanics

| Mechanic | Description |
|---|---|
| **Continuous zoom** | The scroll wheel drives a continuous level value (1.0–4.0); content LOD, time-compression ratio, background color, and soundscape all interpolate smoothly |
| **Close-up detail layers** | Heavy assets like volumetric nebulae, black-hole lensing, and galaxy close-up particles lazy-mount on "follow + distance threshold" and are released on exit (LRU pool management keeps VRAM in check) — **follow, then keep zooming in** is the universal way to unlock close-up detail |
| **Adaptive quality** | Volume rendering auto-shifts tiers (step count + render resolution) based on sliding-window FPS, degrading gracefully on low-end devices |
| **Level lock** | While following or flying to a body, the view level is locked to its domain (zooming in on an L3 object won't accidentally switch views); press `1`–`4` or `Esc` to unlock |
| **Time compression** | Each level has its own compression ratio (planet view for rotation, universe view for galactic evolution), with logarithmic interpolation across levels |
| **Panel scoping** | View-exclusive options only appear in their own view (hidden outside the domain but state is preserved — e.g. enable vertical expansion in L3, switch to L4, and the Milky Way stays spheroidal) |
| **Event domains** | Dynamic events are isolated per view domain: leave the owning domain for more than 1 second and the event is discarded; auto-triggering only happens inside the domain (see [events-guide.md](events-guide.md)) |
| **Exhibition mode** | All four view domains support automatic touring (`tour=all` rotates through all four domains from the inside out); any interaction pauses it, and it resumes after a brief idle (see [launch-params.md](launch-params.md)) |
