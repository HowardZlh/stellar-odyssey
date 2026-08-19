# Astronomy Lab: Total Solar Eclipse Guide

> 中文原版 / Chinese original: [../solar-eclipse-lab.md](../solar-eclipse-lab.md)

The **Total Solar Eclipse** entry of the Astronomy Lab (`/lab`) recreates three real
total eclipses from authoritative ephemerides: the 2027 eclipse of the century over
Egypt, the 2035 eclipse passing right by Beijing, and the historic 1919 eclipse with
which Eddington confirmed general relativity. You stand at a fixed spot on the
centerline of maximum eclipse and scrub a timeline from first to fourth contact —
apparent diameters, contact times and the distribution of Baily's beads all come from
real data (NASA/Espenak contact times, JPL Horizons ephemerides, LRO/LOLA lunar limb
elevations). The entry is entirely free.

## Entering the lab

- Use the "Astronomy Lab" entry on the main control panel, or visit `/lab` →
  "Total Solar Eclipse" → enter;
- Or open the scene directly: `/lab/solar-eclipse`.

A one-time **viewing-safety notice** appears on your first visit (see below) and never
repeats once confirmed.

## Three event tabs

| Event | Observing site | Totality | Highlight |
|---|---|---|---|
| 2027-08-02 | New Valley, Egypt (centerline) | 6 min 23 s | Longest easily reachable land totality of the 21st century (magnitude 1.079) |
| 2035-09-02 | Huairou–Miyun, outskirts of Beijing (centerline) | 1 min 51 s | The centerline sweeps west-to-east right past Beijing's northern suburbs |
| 1919-05-29 | Sobral, Brazil (historical scene) | 5 min 14 s | The decisive data of Eddington's expeditions came from this station |

## Two viewpoints

| View | How to enter | Controls |
|---|---|---|
| Ground (default) | Panel "Ground" | Drag / two-finger scroll to look around; pinch (trackpad or touch) to zoom the field of view — the Sun and Moon are only 0.5° across, zoom in to see the bite and Baily's beads |
| Space | Panel "Space" | Drag to orbit the Earth (a DSCOVR-style vantage), scroll or pinch to zoom; press play to watch the small umbral ellipse sweep the ground west-to-east at over 1,700 km/h, with the centerline path drawn on the globe and an "umbra ×8" toggle (off by default = true scale; the HUD always shows the true width) |

The space view also offers an **inclination story** toggle: the Moon's 5.145° orbital
tilt is shown exaggerated (the HUD notes the true value and display factor) to explain
why the shadow misses the Earth above or below at most new moons — eclipses do not
happen every month.

## The five-contact timeline

The bottom timeline spans from 15 minutes before first contact to 15 minutes after
fourth contact, with five jump anchors: **first contact (C1) → second contact (C2) →
maximum → third contact (C3) → fourth contact (C4)**; the amber highlights near C2/C3
mark the Baily's beads / diamond-ring windows.

- **Guided pace** (default): the partial phases run compressed (~×60), the playback
  slows automatically approaching second contact, **totality plays at ×1 real time**,
  then speeds up again — the HUD always shows the true UTC time and current rate;
- **×1 real time**: the whole event at true speed; drag the slider to seek anywhere —
  every frame is rebuilt purely from the chosen instant.

Worth experiencing deliberately: you barely notice any darkening before 90%
obscuration (the eye's logarithmic response), at 99% the sky still looks like daytime,
and at 100% it plunges — use the "sky cliff" compare buttons to flip between 99% and
100%. During totality, look around: the horizon stays ringed in orange twilight (the
land a hundred-odd kilometres away is still in sunlight — totality is not night), and
bright planets such as Venus and Jupiter appear at their true positions for the epoch.

## Controls quick reference

**Main controls**

- **Exposure**: the automatic (human-eye) mode switches baseline as you cross second /
  third contact, mimicking removing/replacing the solar filter; the manual slider
  sweeps continuously between "filtered ↔ naked eye" (the photosphere outshines the
  corona by ~6 orders of magnitude — no single exposure can show both);
- **Solar cycle**: drag to morph the corona between solar minimum (long equatorial
  streamers) and maximum (round, isotropic);
- **What-if mode**: an Earth–Moon distance slider (363,104–405,696 km) demonstrates the
  **continuous decay from total to annular** — pull the Moon a little farther and only
  a golden ring remains (the HUD flags what-if mode; it is exclusive with the real
  timeline).

**1919 tab only**: the starlight-deflection comparison — hollow rings mark star
positions without the Sun, solid dots the deflected positions, exaggerated ×2500 for
display (the real deflection is only 1.75″ even at the solar limb; the labels show the
true arcseconds). The Sun standing right in the Hyades is exactly why this eclipse was
chosen.

## Soundscape (sonification)

At the bottom of the panel you can enable the **eclipse soundscape** and adjust its
volume (shared with the app-wide volume/mute settings). The soundscape evolves with
the phases: the daytime ambience of the partial phases fades before second contact,
totality is nearly silent (only a faint air-like floor), and the ambience returns
after third contact; light chimes mark second/third contact (the diamond-ring
moments).

> **Scientific framing**: a real eclipse makes no sound of its own. The fading
> ambience and the near-silence of totality are an artistic rendering of the on-site
> atmosphere; the chimes are sonification by design — not the "true sound" of an
> eclipse.

## Viewing safety

The one-time safety notice is worth repeating here:

- On this page (on screen) you may look freely — everything here is a simulation;
- In real life, staring at the Sun damages the retina — **painlessly and
  irreversibly**;
- Only during totality (between second contact C2 and third contact C3) may you
  briefly look with the naked eye, and **only at a total eclipse**; partial and
  annular eclipses are never safe to view unaided — during Baily's beads / the diamond
  ring the photosphere is still exposed and it is still unsafe;
- Sunglasses, homemade filters, smoked glass and exposed film do not protect your
  eyes — none of them work;
- At all other times use **ISO 12312-2** certified solar filters (eclipse glasses), or
  switch to indirect methods such as pinhole projection.

## Mobile

Phones and tablets are fully supported: one-finger drag to look around, two-finger
pinch to zoom (field of view on the ground, distance in space), the control panel
becomes a bottom drawer (tap the arrow in its title bar to expand/collapse), and the
timeline and edge-anchored elements avoid the notch and the home indicator. Low-end
devices degrade automatically (bloom and shadow bands off, render resolution clamped;
the diamond ring approximates its glow with an analytic halo).

## Science and data sources

- Sun–Moon geometry is driven moment-by-moment by baked authoritative ephemerides
  (apparent radii are never constants), and total vs annular is decided by live
  geometry rather than hard-coding; the shadow is a true cone (umbral length
  ~373,000 km with its tip near the Earth — the reason totality paths are only
  100–267 km wide);
- Baily's beads: leak light is computed per limb angle from the real LRO/LOLA lunar
  limb elevation profile (720 points) — the uneven sizes and spacing of the beads come
  from real lunar terrain; the diamond ring is simply the limit of the last remaining
  bead, not a separate effect;
- Registered presentation choices: guided-pace time compression, tone-mapped (non-linear)
  corona brightness, compressed Sun distance and visible shadow cones in the space
  view, the umbra ×8 / inclination / deflection exaggeration toggles (HUD always shows
  true values), prominences as typical-form recreations, shadow bands as a procedural
  stylization, and the "silence" of totality as artistic expression;
- Data sources: NASA Eclipse Web Site / EclipseWise (Fred Espenak — Besselian elements
  and contact times); JPL Horizons (DE441 solar/lunar ephemerides); LRO LOLA LDEM_4
  (lunar limb elevations); Yale Bright Star Catalog, 5th Revised Ed. (Hoffleit &
  Warren 1991); main approximations: 60 s linear ephemeris interpolation (1 s fine
  sampling within ±3 min of C2/C3), no atmospheric refraction, static mean-libration
  lunar limb orientation.
