# Controls and Shortcut Reference

> 中文原版 / Chinese original: [../controls.md](../controls.md)

## Mouse

| Action | Function |
|---|---|
| Left-drag | Rotate the view |
| Right-drag | Pan |
| Scroll wheel | Continuous zoom -- travel seamlessly from a planet's surface to the edge of the observable universe, with automatic content / time-compression / soundscape transitions across view levels |
| Left-click a body | Select it and open the info panel (name / type / real physical parameters / data sources + Fly to / Follow buttons) |
| Click a cutaway layer | In solar cutaway mode, click the core / radiative zone / convective zone for educational notes |

## Keyboard Shortcuts

| Key | Function | Scope |
|---|---|---|
| `1` | Planet view (L1) | Global |
| `2` | Solar System view (L2) | Global |
| `3` | Milky Way view (L3) | Global |
| `4` | Universe view (L4) | Global |
| `Space` | Pause / resume simulation | Global |
| `M` | Sound on / off | Global |
| `O` | Toggle orbit lines | Global |
| `L` | Toggle body labels | Global |
| `R` | Toggle true-scale mode | Global |
| `F` | Fly to the currently selected body | When a body is selected |
| `Esc` | Stop following | While following |
| `[` / `]` | Tour to previous / next body (routed by the current view level: planetary system / solar system / Milky Way / universe sequence) | Global |
| `G` | Toggle galactocentric frame (galactic center fixed, watching the solar system orbit from above) | Milky Way view only |
| `V` | Toggle vertical expansion (galactic disk morphs into an ellipsoid + notable bodies spread out by galactic latitude) | Milky Way view only |
| `H` | Hide / show the entire UI (clean frame for screenshots / recording / projection) | When kiosk mode is not active |

> Shortcuts are ignored while an input field is focused. While kiosk mode is active, any keypress is treated uniformly as "visitor input" (pauses the tour and shows the UI); `H` does not additionally toggle.

## Touch Controls (phones / tablets)

The whole site is touch-ready; every desktop feature has an equivalent touch entry point.

### Gestures

| Gesture | Function |
|---|---|
| One-finger drag | Rotate the view |
| Two-finger pinch | Continuous zoom (zoom speed scales with the current distance, so a few pinches carry you from a planet to the whole universe) |
| Two-finger drag | Pan |
| Tap a body | Select it and open the bottom info card (hit areas of small targets are enlarged -- sunspots, comets, and satellites can all be tapped directly) |

### Mobile Layout

On small screens (width ≤767px) the interface automatically switches to a mobile layout:

- **Top status bar**: pause button + view level + simulation time; tap `▾` to expand details (reference frame, follow state, immersive / hide-UI buttons, etc.).
- **Bottom tab bar**: four entries -- `[? Help] [← Tour →] [☰ Controls] [♥ Donate]`; the controls drawer contains every option of the desktop control panel (view switching, display toggles, event demos, sound, ...); the "♥ Donate" popup gathers the donation entry and partnership contacts (the donation page links to the Contributor Universe page).
- **Bottom info card**: slides up after selecting a body, with "Fly to / Follow" buttons; swipe down or tap the handle to close.
- **Hide UI**: the "Hide UI" button in the status-bar details is equivalent to the desktop `H` key; after hiding, a translucent "Show UI" badge stays in the top-right corner to restore at any time.

### Touch Notes

- Sound must be enabled manually via the controls drawer (browser autoplay policies require a user gesture); if you see "Audio could not start", just tap the sound toggle again.
- iOS Safari does not support web fullscreen; the immersive button falls back to "collapse panels".
- Rendering quality scales automatically with device capability (resolution / particle counts / texture detail); low-end devices and browsers with "data saver" enabled use the lowest tier to stay smooth.

## Control Panel in Detail

The control panel sits in the top-left corner. **Options show or hide intelligently based on the current view level**: global options are always visible across all four views, while view-specific options only appear in their respective view (hidden outside it, but any enabled state and scene effects are preserved).

### Always-visible Sections

| Section | Description |
|---|---|
| **zh / EN language toggle** | Button group to the right of the panel title; the UI, 3D body labels, and educational notes switch instantly and persist (you can also launch with `?lang=en`, see [launch-params.md](launch-params.md)) |
| **View level (keys 1-4)** | Four view-level anchor buttons; the current one is highlighted |
| **Simulation speed (Space to pause)** | Pause/resume button + speed multiplier slider (×0–×100; each view level also applies its own time-compression ratio) |
| **Sound (M to mute)** | Toggle + volume slider; space is silent, the audio is registered as artistic design |
| **Kiosk mode** | "🎪 Start kiosk mode" button: full-screen automatic tour, any interaction pauses it, and it resumes after a short period of inactivity -- full details in [launch-params.md](launch-params.md) |

### Display Toggles (Global)

| Option | Description |
|---|---|
| Orbit lines (O) | Planet / dwarf planet / comet orbits (L1/L2) + satellite galaxy orbits (L4) |
| Body labels (L) | Name labels at every level (size is clamped at close range to avoid blocking the view) |
| True-scale mode | Bodies mapped linearly to their real sizes -- planets and dwarf planets being tiny is a scientific fact; fly to them for a close-up |
| Bloom | Glow post-processing for luminous bodies; can be disabled on low-end devices |
| Performance monitor (FPS/memory) | Panel showing 500ms-window average FPS + memory usage |

### View-specific Options

| Option | View level | Description |
|---|---|---|
| Satellite orbit lines | L1 Planet | Orbits of the moons in the current planetary system |
| Solar interior cutaway | L2 Solar System | Quarter-cutaway view with clickable layers and educational notes; external activity effects fade out temporarily while enabled |
| Galactocentric frame (toggle with G) section | L3 Milky Way | Reference-frame switch: follow the solar system ↔ galactic center fixed |
| Vertical expansion (V) + gain slider | L3 Milky Way | Galactic disk morphs into an ellipsoid, gain ×1–×6; labels show the unamplified heights inferred from galactic latitude |
| "You are here" marker | L3 Milky Way | Highlights the solar system's position with a ripple pulse and a direction-of-motion arrow |
| Fermi bubbles | L3/L4 | Bipolar glow above and below the galactic center (a Fermi-LAT observed structure; the gamma-ray-to-visible-light rendering is registered as artistic design) |
| Real survey background (2MRS) | L4 Universe | 3D point cloud of 43,488 real galaxies (2MASS redshift survey); the toggle includes notes on three distortions; falls back to a procedural cosmic web when disabled or if loading fails |
| Velocity vector arrows | L4 Universe | Proper-motion directions of Local Group members + value labels |

### Dynamic Event Demos (buttons shown per view level)

| Button | View level | Description |
|---|---|---|
| ☀️ Trigger solar flare demo | L1/L2 | Random active region; unavailable in cutaway mode |
| 🌊 Trigger CME demo | L1/L2 | Coronal mass ejection; if aimed at Earth, an aurora follows |
| 💥 Trigger supernova demo | L3 | Random position within a spiral arm, four-stage animation + permanent remnant |
| ⏩ Preview the Milky Way–Andromeda collision | L4 | 12-second fast-forward through 4.5 billion years; a ⏪ button appears afterwards to restore the pre-preview time |

See [events-guide.md](events-guide.md) for details.

## Touring and Following Bodies

- **Select → Fly to**: the "Fly to" button in the info panel or the `F` key; after a 2.5-second smooth camera move you enter follow mode (camera locked to the body, rotation and zoom still available)
- **Tour sequences** (`[` / `]` or the bottom switcher) are routed by view level:
  - L1: cycles within the current planetary system (the planet itself + its moons, in ascending order of orbital semi-major axis)
  - L2: 15 bodies -- planets + dwarf planets + comets (ascending by orbital semi-major axis)
  - L3: 14 Milky Way stops (heliopause → Sagittarius A* → notable stars / nebulae / clusters)
  - L4: 8 universe stops (Local Group members + M87 + quasar 3C 273)
- **Follow + zoom in to unlock close-up detail layers**: while following, keep scrolling in; heavy close-up assets mount at distance thresholds -- black hole photon rings (Sagittarius A* / Cygnus X-1 / M87 core), volumetric nebula interiors, galaxy close-up particle clouds and volumetric dust disks, etc.; zooming out or switching targets releases them automatically (LRU pool)
- **The view level is locked while following** (no automatic level jumps with camera distance); release with `Esc` or by pressing `1`–`4`
- The "Fly to watch" action on notification cards (supernova / flare / CME) also enters follow mode

## Info Panel (bottom right)

- After selecting a body: name, type, real physical parameters and data sources, with "Fly to / Follow" action buttons at the bottom
- The `▾`/`▸` button in the title bar **collapses/expands** the middle info list (the title bar and action buttons stay); the collapsed state persists across body switches
- When content exceeds the height limit (70vh), a slim scrollbar appears so all parameters remain reachable

## HUD (top right)

- Current view level name and simulation time (UTC)
- Current scale ruler (AU / light-years / Mpc, switching automatically with zoom)
- Reference frame note (heliocentric / galactocentric following the solar system / Local Group barycentric...)
- Follow status with a cancel button
- Milky Way view: galactic year progress (orbit number N + orbital angle) and height above the galactic plane
- Slow-down display hint for fast-period bodies (anti-flicker)
