# Dynamic Event Demo Guide

> 中文原版 / Chinese original: [../events-guide.md](../events-guide.md)

Stellar Odyssey ships with four kinds of dynamic astronomical events: **solar flares, coronal mass ejections (CMEs), supernova explosions, and galaxy collision/merger**.
Events fire automatically according to physically motivated probabilities, and can also be demoed manually from the control panel.

> Note: manual demos are limited to 5 per day on the free experience (resets each calendar day;
> ambient auto-triggered events don't count and are unrestricted). Supporters get unlimited demos —
> see [Supporter Unlock](unlock-guide.md) for tiers and redemption.

## Events and View Domains

Each event type belongs to a specific view domain — it only auto-triggers, shows notifications, and exposes its demo button inside that domain;
**leave the owning domain for more than 1 second and any active event is simply discarded** (it does not resume when you return; you wait for the next trigger).
Domain membership is judged by the **discrete view level** (the current view shown in the HUD) — zooming in and out while following a tour object will not falsely count as leaving the domain.

| Event | Owning view domain | Where the demo button appears |
|---|---|---|
| Solar flare | L1 Planet / L2 Solar System | The panel's "Dynamic Event Demos" section |
| CME (including the Earth-arrival chain) | L1 Planet / L2 Solar System | Same as above |
| Supernova explosion | L3 Milky Way | Same as above |
| Milky Way–Andromeda merger preview | L4 Universe | Same as above |

> There is also a **permanent cyclic exhibit** (not an event, no trigger needed): in L4, the gamma-ray burst GRB 221009A
> replays its full evolution — "flash → relativistic twin jets → fading afterglow expansion shell" — on a 45-second cycle. Fly to it and follow to watch it as many times as you like.

---

## ☀️ Solar Flare

**What it is**: a sudden release of magnetic energy from a solar active region, classified into C/M/X classes.

**How to trigger it**

1. Switch to L1/L2; ideally click the Sun and "fly to" it for a close-up first
2. Click "☀️ Trigger solar flare demo (random active region)" in the panel
3. Or wait for an automatic trigger: a Poisson process with probability modulated by the 11-year solar cycle (more frequent near solar maximum)

**Highlights**

- The flare erupts from a sunspot active region: localized brightening → peak → exponential decay (duration slowed for viewing, registered)
- The notification card shows the flare class (e.g. M5.2) and includes a "fly to the Sun" button
- Strong flares may chain-trigger a CME

**Note**: while the solar cutaway mode is active, the flare button is unavailable (exterior effects have been faded out).

---

## 🌊 Coronal Mass Ejection (CME)

**What it is**: a large-scale ejection of plasma from the corona, traveling at hundreds to thousands of km/s; an Earth-directed CME triggers a geomagnetic storm and aurorae on arrival.

**How to trigger it**: in L1/L2, click "🌊 Trigger coronal mass ejection (CME) demo".

**Highlights**

- A translucent shell expands away from the solar surface (speed in km/s displayed live)
- **If it is aimed at Earth**: the notification shows an estimated arrival time, and on arrival Earth's polar regions light up with **enhanced aurorae** — switch to L1 for a close-up of the poles
- Run it together with a flare to reproduce the linked "flare + CME" event chain

---

## 💥 Supernova Explosion

**What it is**: the violent explosion at the end of a massive star's life; the true rate is roughly one per 50–100 years per galaxy (accelerated in the simulation, registered).

**How to trigger it**

1. Switch to the L3 Milky Way view
2. Click "💥 Trigger supernova demo (random spot in a spiral arm)"
3. Or wait for the Poisson auto-trigger (at the Milky Way view's high time-compression ratio you can expect one within minutes)

**Highlights (full four-stage sequence, 10–30 seconds)**

1. **Progenitor flash**: brightness soars to peak within seconds
2. **Shockwave expansion**: a spherical shock decelerates following the Sedov-Taylor law r∝t^0.4 (translucent shell + brightened rim)
3. **Exponential brightness decay**
4. **Permanent remnant archived**: an expanding nebula + a central compact object — progenitors of ≥20 M☉ collapse into a **black hole**, otherwise a **neutron star**

**Tips**

- Click "**Fly to watch**" on the notification card to auto-fly the camera to the explosion site and follow it
- Remnants persist forever on the galactic disk (turn on vertical expansion `V` to watch remnants lift with the disk)
- The blast comes with a low-frequency shock sound effect (procedurally synthesized)

---

## ⏩ Milky Way–Andromeda Merger Preview

**What it is**: the Milky Way and the Andromeda galaxy (M31) are approaching each other at ~110 km/s and will collide and merge into the elliptical galaxy "Milkomeda" in about 4.5 billion years.

**How to trigger it**: switch to the L4 Universe view and click "⏩ Preview the Milky Way–Andromeda collision".

**Highlights (4.5 billion years fast-forwarded in a 12-second eased sequence)**

1. **Final approach**: the two galaxies close in, with tidal distortion gradually appearing
2. **First passage (T0)**: the two disks pass through each other + starburst brightening, with an evolution explainer card popping up
3. **Oscillating rebounds**: repeated passes under gravitational tug-of-war
4. **Core coalescence**: the twin nuclei spiral in and merge
5. **Final-state Milkomeda**: an elliptical galaxy, with the HUD stage label tracking the whole way

**Restoring**: after the preview, click "⏪ Restore pre-preview time" — simulation time, the countdown, and all stage states are fully restored.

---

## Event Mechanics in Detail

| Mechanic | Description |
|---|---|
| Two layers: visibility and availability | Demo buttons are **hidden** outside their domain; inside the domain they are **grayed out** if a same-type event is in progress or preconditions are unmet |
| Hard isolation | Leaving the domain for >1 second discards active events (the timer is exempt during anchor switches and fly-to camera moves); a discarded supernova archives no remnant, and a discarded merger preview auto-rewinds time |
| Auto-triggering | Flares/CMEs/supernovae follow a Poisson process gated by view domain; no progression while paused |
| Sound coupling | Supernova low-frequency shock, flare eruption sound, UI interaction sounds (mutable) |
