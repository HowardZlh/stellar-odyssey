# Scientific Accuracy Notes

> 中文原版 / Chinese original: [../science-notes.md](../science-notes.md)

Stellar Odyssey puts "**scientific accuracy first**": all astrophysical parameters are based on real scientific data, and orbital motion is computed from Kepler's laws.
At the same time, some artistic liberties were necessary for a good visual experience — **every one of them is explicitly registered in-app, in code comments, or in the requirements docs**.
This document collects both, so you can tell "real" from "demonstration".

## ✅ Real Data and Physics

| Content | Basis |
|---|---|
| The six planetary orbital elements (semi-major axis / eccentricity / inclination / ascending node / argument of perihelion / initial phase) | NASA JPL Keplerian Elements (J2000 epoch) — planet positions at app launch match the real current date |
| Planetary physical parameters (radius / mass / rotation / axial tilt) | NASA Planetary Fact Sheet (Venus' retrograde rotation, Uranus' 97.8° sideways tilt, etc. are rendered faithfully) |
| Orbital motion | Kepler's equation solved via Newton iteration, satisfying the equal-area law (second law) — fast at perihelion, slow at aphelion |
| Moon and satellite data | NASA Planetary Satellite Fact Sheet (the Moon's tidal locking with 5.145° inclination, the Galilean moons' 1:2:4 resonance, Triton's 156.9° retrograde orbit) |
| Comets | JPL SBDB: Halley e≈0.967 with a 162° retrograde orbit; the 15×8 km peanut-shaped nucleus follows ESA Giotto observations |
| Solar activity | Differential rotation (25.4 days at the equator / 34 days at the poles), the 11-year cycle, sunspot latitude migration per the butterfly diagram, the Sedov-Taylor shock law |
| Milky Way structure | Barred-spiral morphology, four major spiral arms, the Sun at ~26,000 light-years from the galactic center, a galactic year of ~230 million years, Lin & Shu density wave theory; HI warp with m=1 morphology (Levine, Blitz & Heiles 2006), Fermi bubble shape parameters (Su, Slatyer & Finkbeiner 2010, Fermi-LAT) |
| Positions of L3 special objects | Heights derived from true galactic latitude (SIMBAD); Betelgeuse / Sirius / the Crab pulsar / M13 and the rest are all based on real prototypes |
| Stellar surface colors and physics | Planck blackbody spectrum → sRGB color from temperature (SIMBAD/literature Teff: Betelgeuse Joyce 2020, Sirius Kervella 2003, δ Cephei Mérand 2005, etc.); limb-darkening coefficients binned by spectral type (Claret 2000 V-band approximation) |
| Pleiades member stars | ESA Gaia DR3: 600 stars selected by parallax 7.0–7.7 mas + comoving proper motion; 3D positions / magnitudes / B−V are all real (selection criteria and the ADQL query registered with the artifact) |
| M13 globular cluster | Harris catalog King profile (core radius / tidal radius / concentration) + HR-diagram color distribution |
| Black hole gravitational lensing | Photon ring / background bending / Doppler beaming / gravitational redshift rendered as a schematic raymarch, with parameters based on real prototypes: Sgr A* (4.3 million M☉), Cygnus X-1, M87* (6.5 billion M☉, disk inclination 17° near face-on, matching the EHT 2019 first black hole image) |
| Galaxy close-up imagery | Close-up particle distributions and wide-shot textures for M31 / M33 / LMC / SMC are baked from public-domain DSS2 color survey imagery (spiral arms / dust lanes / star-forming regions match the photographs; M31 deprojected back onto the disk plane at its true 77° inclination); the LMC's 30 Doradus placed from SIMBAD coordinates |
| Large-scale cosmic background | The 2MASS Redshift Survey 2MRS (Huchra et al. 2012), 43,488 real galaxies: the Virgo Cluster concentration, the zone of avoidance, and filament orientations are all observational data; redshift → distance uses the Hubble-flow approximation (H₀=70 km/s/Mpc) |
| Galaxies and large-scale structure | NED / Tully et al. 2014: Local Group member distances, M31 approach speed ~110 km/s, the Virgo Cluster, Laniakea, the observable-universe radius of ~46.5 billion light-years; M87 globular cluster system count (Tamura et al. 2006), the GRB fireball-model picture (Piran 2004) |
| Surface textures | Built from NASA observational data (Solar System Scope), the New Horizons Pluto mosaic (the unmapped south-polar night region faithfully left black), the Dawn Ceres mosaic, normal maps converted from GEBCO/LOLA elevation data |

Data sources are **registered per object in the info panel**; in-code registration lives in the files under `src/data/`.

## 🎨 Registered Artistic Liberties

The following liberties were introduced for the sake of the visual experience, and each is registered in-app (HelpHint / panel copy) and in code comments:

### Scale and Geometry

| Liberty | Reason |
|---|---|
| Default mode exaggerates body radii with logarithmic compression | At true scale, planets are invisible at orbital distances; turn on true scale mode (`R`) for the faithful rendering |
| Dwarf planets and artificial satellites extra-enlarged | Keeps them identifiable; being too small to see at true scale is itself a scientific fact |
| Oort cloud boundary compressed to the L2/L3 transition | The true 2,000–100,000 AU span is far too large |
| L4 intergalactic distances logarithmically compressed | Keeps everything on screen at once |
| Horizontal distances of L3 special objects are schematic | Heights follow true galactic latitude; horizontal distances balance composition |
| Vertical expansion (V) is a visual exaggeration as an observation aid | Indicator lines are labeled with the unexaggerated true heights derived from galactic latitude |
| The Sun's vertical oscillation wave amplified ×10 visually | The true amplitude is only ±300 light-years (~1% of the orbital radius), indiscernible without amplification; true scale mode does not amplify |

### Time

| Liberty | Reason |
|---|---|
| Different time-compression ratios per view level | Planetary rotation and galactic evolution differ by 10+ orders of magnitude in timescale |
| Fast-period objects (ISS etc.) rate-clamped and slowed for display | Visual spin above 0.5 rev/s flickers; the UI notes "slowed for display" |
| Supernova rate accelerated | The true rate is roughly one per 50–100 years per galaxy; the notification includes a note |
| Flare duration slowed for viewing | An event that really lasts minutes is unfolded at an observable pace |
| The Sirius binary's 50-year mutual orbit slowed | Rate clamping |

### Visuals

| Liberty | Reason |
|---|---|
| Star twinkling shown only in the planet view | Stars do not twinkle in vacuum (twinkling comes from atmospheric turbulence); kept as "surface viewpoint" ambience |
| Sunspot/prominence sizes and activity rates enlarged for demonstration | Keeps them identifiable up close; chromosphere thickness exaggerated to +1.5% |
| ISS model colored by shape-based heuristics | The public-domain NASA model's materials are a uniform gray |
| Procedural textures for Eris / Makemake / Haumea | No spacecraft imagery exists; inferred from albedo / color / spectroscopic observations |
| Volumetric nebulae are procedural density fields | Only the relative placement and magnitude of signature features (scalloped cavity / dark bay / filaments — e.g. M42's four features) are reproduced; cloud detail is procedurally generated and differs from the real sky |
| M87* photon ring size compressed | The true mass ratio to Sgr A* is ~1,500×; compressed by ~1.9× to fit on screen together (the 17°-inclination near-face-on morphology is preserved) |
| Three distortions in the 2MRS point cloud | Peculiar-velocity contamination (the "fingers of god" effect in clusters), nearby (cz≲1,000 km/s) distance errors of up to tens of percent, and the \|b\|<5° galactic band being a dust-extinction observational limit rather than a real void — all registered in the toggle's explanatory copy |
| Fermi bubbles rendered in visible light | The real structure is gamma-ray; presented artistically as a pale violet → magenta diffuse glow (shape parameters are real) |
| HI warp rim amplitude enlarged | At the disk's visual truncation the true amplitude is only ~0.3 kpc, indiscernible edge-on; enlarged to 3,000 ly (radial growth trend still follows the Levine m=1 morphology) |
| LMC 30 Doradus enlarged 5× | Its true ~600 ly diameter is only 2% of the LMC disk, indiscernible at true proportion (position conversion is real) |
| GRB close-up cycle compressed | The real afterglow evolves over days to months; compressed into a 45-second replay cycle (the R∝t^¼ expansion and power-law dimming relations are preserved); the outward-moving jet knots are a visualization, not real apparent superluminal motion |
| Lensing arcs / cluster lensing | The prototype is real (Abell 370); the SIS screen-space deflection is schematic |

### Sound

| Liberty | Reason |
|---|---|
| All sound effects are artistic designs | **Vacuum is silent** — explicitly registered in-app; planetary ambience is differentiated by each planet's atmospheric character (Mercury and the dwarf planets are near-vacuum and almost silent), while the Sun's roar and the black holes' hum are atmospheric expression |

## Design Principles

1. **When visualization conflicts with science, register it explicitly** — never silently "beautify" the data
2. **Default mode favors experience, true scale mode favors fact** — one-key toggle (`R`)
3. **Speculative content is labeled as speculative** — e.g. procedural dwarf-planet textures, the procedural Tiangong geometry
4. **Data sources are traceable** — registered item by item in the info panel and code comments

If you spot a scientific inaccuracy, please open an issue.
