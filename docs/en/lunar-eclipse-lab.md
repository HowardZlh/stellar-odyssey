# Astronomy Lab: Lunar Eclipse (Blood Moon) Guide

> 中文原版 / Chinese original: [../lunar-eclipse-lab.md](../lunar-eclipse-lab.md)

The **Lunar Eclipse** entry of the Astronomy Lab (`/lab`) recreates four real lunar
eclipses from authoritative ephemerides: the deepest and darkest total eclipse of this
century (2029), the 2026 partial eclipse that misses totality by a hair, the 2027
penumbral eclipse that is all but invisible to the eye, and the historic 1992 eclipse
rated Danjon L=0 in the aftermath of the Pinatubo eruption. You can watch the blood
moon from the ground, fly out to see the whole Earth shadow cone, or stand on the lunar
surface and look at the ring of Earth's atmosphere that paints the Moon red —
magnitudes, contact times and shadow radii all come from real data (NASA's 5MCLE
century catalogue, JPL Horizons DE441). The entry is entirely free.

## Entering the lab

- Use the "Astronomy Lab" entry on the main control panel, or visit `/lab` →
  "Lunar Eclipse" → enter;
- Or open the scene directly: `/lab/lunar-eclipse`.

A lunar eclipse is **safe to watch with the naked eye from start to finish**, so this
entry has no viewing-safety notice — a contrast with the solar eclipse lab that is
itself worth noting (see the "solar vs lunar" comparison card in the space view).

## Four event tabs

| Event | Observing site | Type | Highlight |
|---|---|---|---|
| 2029-06-26 (default) | São Paulo, Brazil (Moon 87° high at greatest) | Total | Deepest and darkest lunar eclipse of the 21st century (umbral magnitude 1.8436, γ≈0.012 — almost dead through the shadow axis), 1 h 41 min 53 s of totality (Saros 130) |
| 2026-08-28 | Manaus, Brazil (83°) | Partial | Magnitude 0.9299 — "so close to total"; at greatest eclipse only a sliver of bright limb remains (Saros 138) |
| 2027-02-20 | Lagos, Nigeria (78°) | Penumbral | Umbral magnitude −0.0569: nothing perceptible to the naked eye all the way through — **seeing no change is the correct outcome** (Saros 143) |
| 1992-12-09 | Madrid, Spain (72°) | Historical · total | Rated Danjon L=0 after the Pinatubo eruption (Saros 125) — the other end of the Danjon scale from 2029 |

> None of the four eclipses is visible from China (Beijing is in daylight, or the Moon
> has set, at greatest eclipse). Sites were chosen for "whole eclipse visible + highest
> Moon at greatest eclipse" and are presented as they are. For the Chinese-language
> narrative, see the selenelion easter egg on the 1992 tab (Beijing) below.

## Three viewpoints

| View | How to enter | Controls |
|---|---|---|
| Ground (default) | Panel "Ground" | Drag / two-finger scroll to look around; pinch (trackpad or touch) to zoom the field of view — the Moon is only 0.5° across, so zoom in to see the umbral bite and the radial colour gradient across the disc |
| Space | Panel "Space" | Drag to orbit the Earth, scroll or pinch to zoom. The **two true cones** (umbra + penumbra) share the frame with the Moon's orbit, with **no axial compression**: the cone is ~1.4 million km long and the Moon only reaches 27% of the way along it — readable at a glance |
| Moon | Panel "Moon" | Stand on the near side and watch a solar eclipse by Earth: a pitch-black Earth disc with a ring of red light on its limb — that ring is the source of the blood moon's colour |

All three views share one timeline: the instant is preserved when you switch, with a
1.6 s camera move between them.

**Dual body scale in the space view** (defaults to "Artistic"): artistic mode scales
the Earth–Moon system, the cones and the section discs by a **single radial factor**
(≈×14.6, derived from Earth's artistic factor), so every teaching ratio is preserved
exactly: the umbra at the Moon's distance is ≈2.6 Moon diameters and ≈0.72 Earth radii,
and the cone is ≈3.7 times the Earth–Moon distance. Switch to "Real" for true scale,
with a "radial ×4" toggle (on by default) that widens the Earth, Moon and cones by four
laterally while leaving axial distances alone. **Whatever mode and toggle combination
you pick, the HUD keeps showing the same true cone length / lunar distance / umbral
width, and the on-screen ratios stay constant** — that is this entry's core promise.

The space view also offers: the shadow section discs at the Moon's distance
(two translucent circles plus the lunar track, with the travelled part recoloured),
camera presets "Overview / Moon close-up", a real J2000 star dome with a procedural
Milky Way band, a planetary-orbit backdrop (plus an asteroid belt in artistic mode),
and a **node geometry** toggle that exaggerates the Moon's 5.145° orbital inclination
and lets you flip between "full moon (lunar eclipse) ↔ new moon (solar eclipse)" to see
the shadow cone reverse direction.

## Seven-contact timeline

The timeline at the bottom spans the whole event, with anchors added or dropped per
event: **P1 penumbral begin → U1 partial begin → U2 total begin → greatest →
U3 total end → U4 partial end → P4 penumbral end** (a partial eclipse has no U2/U3, so
5 anchors; a penumbral eclipse only has P1 / greatest / P4, so 3).

- **Fast playback** (default): a constant rate compresses the 4–6 hour event into about
  90 seconds (lunar eclipses evolve slowly, so no staged speed curve is needed) — the
  HUD always shows the true UTC time and the current rate;
- **×1 real time**: true speed throughout. Drag the slider to seek anywhere; the frame
  is rebuilt solely from the instant.

## Things worth seeking out

- **The umbra is a radial gradient, not a uniform red wash**: much darker towards the
  shadow's centre, brighter and more yellow towards its edge. This is the detail most
  blood-moon renderings get wrong, and the most important piece of physics here;
- **The penumbral phase shows almost nothing**: that is real — about 36.3% of lunar
  eclipses never leave the penumbra. Turn on the "triptych" to compare
  penumbral / partial / total side by side: the penumbral panel really does look
  unchanged;
- **Stars come out during totality**: at greatest eclipse the Moon is ~10,000× fainter
  than full, the stars it had drowned out return, and the ground darkens with it
  (sky glow, ground and ridge are all driven by the same moonlight chain);
- **The round-Earth argument**: turn on "fit circle over the umbra" and the same
  curvature fits the bite at any instant, in any of the four events. This is exactly how
  the Greeks reasoned their way to a spherical Earth;
- **Cause and effect closed**: drag the turbidity slider in the ground view to deepen
  the blood moon, then switch to the Moon view — the red ring on Earth's limb has
  deepened in step. Both are driven by the same atmospheric state.

## Controls at a glance

- **Danjon scale L0–L4**: five one-click presets plus a continuous turbidity /
  volcanic-dust slider (the 1992 tab starts at L=0 with a Pinatubo story card).
  The scale itself is a **subjective visual rating** (Danjon 1921) with no standard
  colour values — the colours here are an artistic mapping;
- **Exposure**: a simple slider (×0.25–×4). Turning it up ≈ a long camera exposure,
  turning it down ≈ what your eyes actually see — most blood-moon photographs online
  are far brighter than the naked-eye view;
- **Triptych / round-Earth argument**: teaching toggles, ground view only;
- **Space-view toggles**: dual body scale, radial ×4, section discs, planetary orbits,
  node geometry (new ↔ full moon), the 14-row solar-vs-lunar comparison table, the
  half-saros pairing card and a cross-link to the solar eclipse lab;
- **Cultural-history card**: the Chinese "celestial dog", Rahu, the Inca jaguar, the
  Babylonian substitute king, the Norse wolf Hati — the card is permanently labelled
  "historical records and mythology (not a scientific explanation)", kept apart from the
  physics, and contains a single bell strike you can play.

## Selenelion easter egg (1992 tab)

A selenelion is the eclipsed Moon and the Sun visible at the same time on opposite
horizons. Geometrically they sit exactly opposite during a lunar eclipse, so only
atmospheric refraction lifting both above the horizon makes the pairing possible.
Not a thought experiment: the morning of **1992-12-10 in Beijing** (this very eclipse)
was a real occurrence — the totally eclipsed Moon setting in the northwest while the Sun
rose in the southeast.

Open it from the "see it yourself" button on the selenelion card of the 1992 tab: a
standalone scene with one-tap aiming at either horizon, both bodies drawn in two states
(dashed circle = geometric position, solid = refracted apparent position) and a HUD that
always shows the ≈0.6° refraction lift. Scrub to around UT 23:27: both bodies are
geometrically below the horizon, yet you can see them both.

## Soundscape (sonification)

The panel's soundscape section turns audio on and sets the volume (shared with the main
app's global volume / mute). The lunar soundscape is much more restrained than the solar
one: a single layer of night ambience (a stylised insect chorus) that shifts **subtly**
as the eclipse deepens, plus a light chime at each of the seven contacts (lightest for
the penumbral contacts, brighter for the umbral ones).

> **Scientific framing**: a real lunar eclipse makes no sound of its own. The shift in
> the night ambience is an artistic rendering of the mood — deliberately kept faint,
> because a lunar eclipse has nothing like the abrupt hush reported at a total solar
> eclipse; the contact chimes are sonification by design.
> The **bell** inside the cultural-history card is a cultural rendition ("beat drums and
> ring bells to drive off the celestial dog"): one strike per click inside that card
> only, never sounding on its own along the timeline, kept apart from the scientific
> soundscape.

## On mobile

Phones and tablets are fully supported: one-finger drag to look around, pinch to zoom
(field of view in the ground/Moon views, distance in the space view). The control panel
turns into a bottom drawer (tap the arrow in the title bar to expand or collapse; it
starts collapsed so it never covers the scene), the timeline and edge-anchored elements
clear the notch and the home indicator, and every tappable element is at least 44 pt.
Low-powered devices step down automatically: bloom off, render resolution capped, and
the Milky Way band / asteroid belt in the space view plus the shading detail of the
Moon-view atmospheric ring simplified — **all geometry and numbers stay unchanged**.

## Science and data sources

- **The cones are true cones**: umbral and penumbral radii are solved analytically as
  functions of distance from Earth's centre (not a fixed-coefficient cylinder). At the
  mean lunar distance of 384,400 km the umbral radius is ≈4,600 km (0.72 R⊕) and the
  penumbral radius ≈8,200 km (1.28 R⊕), with a cone length of ≈1.4 million km. The
  shadow-enlargement convention is **Danjon's ×1.01** (= 1 + 1/85 − 1/594), the same
  formula the authoritative 5MCLE uses; recomputing the four events from Horizons
  ephemerides with this convention agrees with Espenak's catalogue to <0.003 in
  magnitude and <0.002 in γ;
- **Blood-moon colour**: the radial gradient inside the umbra is driven by interpolating
  the five Danjon presets, and all three views share the same shading function (the CPU
  and GLSL versions mirror each other), so there is no "one look on the ground, another
  in space" divergence;
- **Ozone-induced blue-green umbral rim** (often quoted for L=4) and any **link between
  the solar cycle and blood-moon darkness** could not be traced to a reliable primary
  source, so **neither appears in any wording or in the colour table** (the L4 rim is
  bright yellow-white);
- **Registered presentation choices**: accelerated playback (the HUD always shows the
  true time and rate), Danjon colours as an artistic mapping of a visual rating, the
  compressed Sun distance in the space view (the cone's *axial* scale is true — a
  selling point, not an artistic liberty), radial magnification and the single artistic
  radial factor (all radial ratios remain numerically identical), exaggerated
  inclination for the node demo, limb brightening via a simplified opposition term
  (not a full Hapke model), the Moon-view red ring as a mechanism-faithful artistic
  rendition (its width is exaggerated; the real atmospheric layer is only ~1.2% of
  Earth's radius), the selenelion refraction lift as a teaching-simplified curve
  (matching the real ~34′ magnitude), and the night soundscape and contact chimes as
  sonification;
- **Data sources**: NASA Lunar Eclipse Page / the 5MCLE century catalogue
  (Fred Espenak & Jean Meeus — magnitudes, γ, contact times); JPL Horizons (DE441 solar
  and lunar ephemerides); the Danjon (1921) brightness scale; Yale Bright Star Catalog,
  5th Revised Ed. (Hoffleit & Warren 1991). Main approximations: 60 s linear ephemeris
  interpolation, atmospheric refraction not modelled (except in the selenelion egg),
  a single fixed observing city per event, and a static mean-libration lunar orientation.
