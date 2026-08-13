# Astronomy Lab: Midsummer Twin Meteor Showers Guide

> 中文原版 / Chinese original: [../meteor-shower-lab.md](../meteor-shower-lab.md)

The Astronomy Lab (`/lab`) hosts interactive sky experiments built on real catalogs and physical models.
Its first entry, **Midsummer Twin Meteor Showers**, recreates the Perseids (peak Aug 13) and the
kappa-Cygnids (peak Aug 17), plus the historic **1966 Leonid storm** — every meteor trajectory is
numerically integrated from the ablation ODE, under a sky of 8,404 real stars from the Yale Bright
Star Catalog projected into horizontal coordinates.

## Entering the lab

- Use the "Astronomy Lab" entry in the main control panel, or visit `/lab` → "Midsummer Twin Meteor Showers" → Enter;
- The scene page is also directly addressable: `/lab/meteor-shower`.

## The three scene tabs

| Scene | Radiant | Entry speed | ZHR | Parent body |
|---|---|---|---|---|
| Perseids | RA 46° / Dec +58° | 59 km/s | 100 | Comet 109P/Swift–Tuttle |
| kappa-Cygnids | RA 286° / Dec +59° | 25 km/s | 3 | Undetermined (candidates still debated) |
| Leonid storm 1966 | RA 152° / Dec +22° | 71 km/s | 40,000 (conservative literature value) | Comet 55P/Tempel–Tuttle |

- **Perseids**: fast, bright blue-white streaks with plentiful flux — the best first watch;
- **kappa-Cygnids**: slow amber meteors, sparse flux but a higher fireball fraction — lean on the fast-forward buttons;
- **Leonid storm 1966**: a re-creation of the 1966-11-17 "stars fell like rain" event
  (peak estimates once reached ~40 meteors per second) — most spectacular with the time-lapse gears.

The fact card at the top of the panel follows the active tab with radiant coordinates, entry speed, ZHR, and parent body.

## Viewing modes

| Mode | How to enter | Controls |
|---|---|---|
| Ground (default) | Panel "Ground" | Drag / two-finger scroll to look around; trackpad pinch or touchscreen two-finger pinch to zoom (FOV) |
| Space | Panel "Space" | Drag to orbit above the 80–115 km burn layer (reference discs toggleable); scroll to zoom out until the full Earth and its airglow limb come into view |
| Follow | Check "Follow on demo", then hit a demo button | Ride alongside one meteor in ×0.1 slow motion: drag to orbit 360°, scroll to adjust distance (0.6–6 km); after burnout the camera lingers on the afterglow — ESC or the button exits anytime |

Finding the radiant: enable the radiant marker and look around for the crosshair with the
constellation name — on the sky every meteor streaks away from that single point
(a perspective effect: the meteoroids actually fly on parallel paths in space).

## Controls at a glance

**Main controls**

- **Time rate** ×0–×10: 0 pauses; **time-lapse** gears ×1/×10/×60 — at ×60 the streaks stretch into an integrated full-path exposure (time-lapse camera convention);
- **Local time offset** ±6 h: the HUD shows local time and radiant altitude live; push into daytime and both meteors and stars fade out through twilight;
- **Light pollution (limiting magnitude)** 1.0–6.5: city ↔ dark-site sky quality, affecting both visible star counts and meteor flux;
- **Observer latitude** ±90°: reorients the sky and the radiant's rise/set.

**Advanced (collapsed)**: fireball rate gain, upper-atmosphere wind speed (afterglow drift amplitude).

**Viewing aids**

- **Countdown HUD**: real seconds until the next meteor / next fireball;
- **Fast-forward**: jump to ~1.5 s before the next genuinely scheduled ignition (the timeline truly advances — clock and sky move in sync);
- **Demo**: inject a meteor / fireball immediately (outside the timeline; a persistent on-page note says so).

## Meteor audio (sonification)

Enable **meteor audio** at the bottom of the panel and adjust its volume (shared with the app-wide
global volume/mute settings).

> **Scientific framing**: real meteors are silent. The descending whistle emulates **radio echoes** —
> forward scatter of radio signals off the ionized trail, a radio-observation technique (the same
> principle behind amateur meteor-scatter communication); the crackle at a fireball's terminal flash
> corresponds to **electrophonic sounds**, a rare and still-debated phenomenon. Both are
> sonifications of observation techniques/phenomena, not the "true sound" of a meteor.

When ordinary meteors get dense, only the brighter ones sound (to prevent listening fatigue);
fireballs get a longer whistle plus a crackle at the moment of fragmentation.

## Mobile

Phones and tablets are supported: one-finger drag to look around, two-finger pinch to zoom the FOV,
and the control panel becomes a bottom drawer (tap the arrow in the title bar to expand/collapse).
Low-end devices automatically step down quality (bloom off, particle counts halved, render
resolution clamped) — smoothness first.

## Science & data sources

- Meteor trajectories: the ablation ODE (atmospheric ram-pressure deceleration + vaporization mass
  loss) integrated with RK4; deceleration compression, the brighten-then-extinguish light curve,
  and terminal fireball fragmentation all emerge from the physics — no random line-drawing;
- Meteoroids **vaporize completely at 80–115 km altitude and never reach the ground** (the follow
  view shows a science note after burnout);
- Flux model: ZHR → visible hourly rate (radiant-altitude + limiting-magnitude corrections),
  applied live as you move the sliders;
- Data sources: IAU Meteor Data Center (radiants/entry speeds); Yale Bright Star Catalog,
  5th Revised Ed. (Hoffleit & Warren 1991, 8,404 stars with mag ≤ 6.5); the ablation model is a
  classical approximation.
