# Development Guide

> 中文原版 / Chinese original: [../development.md](../development.md)

## Tech Stack

| Area | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 + React 19 | App Router, entry under `src/app/` |
| Language | TypeScript (strict) | `any` is banned; functions require explicit return types |
| 3D | Three.js + React Three Fiber | Logarithmic depth buffer supports rendering across 10+ orders of magnitude; raymarched volume rendering (emission–absorption integration + 3D density textures + blue-noise dithering + half-resolution RT + FPS-adaptive quality tiers); gravitational-lensing shaders for black holes / galaxy clusters |
| Data pipeline | `scripts/bake-data/` (native Node TS, zero new dependencies) | Gaia DR3 / SIMBAD / 2MRS / DSS2 imagery → static artifacts in `public/data/` (≈2.5 MB, zero external requests at runtime; snapshots committed to the repo guarantee idempotent, offline-reproducible builds) |
| State | Zustand | Single store (`src/store/index.ts`); per-frame render data goes through the registry pattern, bypassing React |
| Audio | Web Audio API | Procedural synthesis (no audio asset files), PannerNode 3D positioning |
| Styling | Tailwind CSS | Deep-space theme (`space-*` palette) |
| Testing | Jest + React Testing Library | 3,000+ test cases, coverage gate ≥90% (enforced by the jest config, blocked in CI) |

## Common Commands

```bash
npm run dev            # Dev server (default port 3000, reserved for user testing)
npm run dev:3100       # Agent/parallel-instance only (port 3100 + separate build dir, independent of 3000)
npm run build          # Production build
npm run start          # Production server
npm test               # All unit tests
npm run test:coverage  # Coverage report (gate ≥90%, fails below threshold)
npm run type-check     # tsc --noEmit
npm run lint           # ESLint
npm run format         # Prettier
npm run bake:data      # Re-bake the real-data artifacts in public/data/ (idempotent; --fetch flags re-pull snapshots from the network)
```

## Directory Layout

```
src/
├── app/                # Next.js entry (layout/page + /dev/preview page route)
├── components/
│   ├── Scene/          # Scene-level components: Galaxy / Universe /
│   │   │               #   Supernova / StarField / SolarSystem /
│   │   │               #   volumetric nebula layer / black-hole lensing layer /
│   │   │               #   galaxy close-up layer / dust-disk layer ...
│   │   └── volumetric/ # Volume rendering infrastructure: VolumeMaterial (raymarch material) /
│   │                   #   VolumeHalfRes (half-resolution RT + composite) / BlackHoleLensed ...
│   ├── CelestialBody/  # Celestial body components: Sun / Planet / Moon / Comet /
│   │                   #   SpecialBodies / SunActivity / SunCutaway ...
│   ├── Camera/         # Camera controls, continuous zoom, fly-to/follow camera moves
│   ├── UI/             # ControlPanel / HudInfo / InfoPanel / HelpHint /
│   │                   #   event notifications / ClampedHtmlLabel ...
│   ├── Audio/          # Audio engine integration
│   └── dev/            # Dev preview harness components (DevPreviewHarness + per-body preview scenes)
├── data/               # Celestial datasets (planets/moons/comets/special bodies/galaxies/texture & model manifests)
│                       #   — data sources annotated and registered per entry
├── hooks/              # useKeyboardShortcuts / useCamera / useAudio /
│                       #   useDetailLayer (detail-layer four-pool LRU) / useGalaxyImageMaps ...
├── utils/              # Pure-function layer (the project's core testable logic):
│                       #   physics (Kepler) / scale / time / cameraFocus /
│                       #   eventScopes / panelScopes / volume (density-field primitives) /
│                       #   adaptiveQuality / bakedData (artifact loading & validation) ...
├── types/              # Shared type definitions (ViewLevel, etc.)
└── store/              # Zustand store + tick driver
scripts/bake-data/      # Offline baking: Pleiades (Gaia DR3) / stellar parameters (SIMBAD) /
                        #   M13 (Harris) / 2MRS catalog / DSS2 galaxy imagery sets
public/data/            # Baked artifacts + meta (source/license/retrievedAt registered)
```

## Core Architecture Conventions

### 1. Pure Functions First

All computable logic (physics/scale/gating/animation curves) is written first as pure
functions in `src/utils/` with unit tests; components only do wiring. Formulas inside
shaders must have a **CPU mirror function** in utils, with unit tests asserting the two
sides share the same constants.

### 2. Single Source for Rendering and Resolution

Per-frame dynamic poses (e.g. the galactic-center-fixed reference frame, vertical
spread gain) are written into a registry by a **single writer**
(e.g. `renderedGalacticFrame()`); rendering components and camera-focus resolution
(`cameraFocus.ts`) consume the same data source, guaranteeing that "fly-to/follow
landing points match what you see".

### 3. Scope Registries

Cross-cutting scope decisions are consolidated into registry pure functions; scattering
conditionals across components is forbidden:

- `utils/eventScopes.ts` — dynamic-event view scopes (triggering/notifications/button availability, out-of-scope discard)
- `utils/panelScopes.ts` — control-panel option visibility per view (15 options × L1–L4 matrix)
- `utils/cycleScopes.ts` — the four tour-scope sequence routing

### 4. Zero Allocations in the Render Loop

Creating new objects inside `useFrame` is forbidden (Vector3 etc. are pre-allocated and
reused); particle systems are advanced in the vertex shader; labels mutate DOM
transforms directly without going through React re-renders.

### 5. State Update Discipline

- `viewLevel` (discrete view) and `continuousLevel` (continuous level) are separated:
  the scroll wheel syncs via `syncZoomLevel`/`syncCameraDistance`, and the level is
  locked during follow/fly-to
- Components should subscribe to boolean/scalar slices of the store where possible to
  reduce re-renders

### 6. Unified Detail-Layer Mechanism (R4-2)

Heavy-asset close-up layers (volumetric nebulae / black-hole lensing / galaxy close-up
particles / star-catalog point clouds) all attach through `hooks/useDetailLayer`:
**four resource pools** (particles / volume / lensing / starCatalog), each with capacity
1, gated on "follow + distance threshold (with hysteresis)", 0.5s fade in/out, and
LRU eviction that unmounts and disposes immediately; particle counts / GPU byte budgets
are registered centrally (`utils/detailLayer.ts`), and the dev hook
`window.__detailLayerDebug` exposes holders and GPU memory usage for headless
verification.

### 7. Transparent-Layer Render Order Registry

The renderOrder of all L4 universe-scope transparent layers is registered in
`utils/universeRenderOrder.ts` (single source of truth; scattered magic numbers are
forbidden); any new transparent layer must take its value from the registry and be
registered in the sequence (unit tests anchor monotonicity/uniqueness, preventing
inter-frame flicker from crossed depth-sort keys).

### 8. Offline Baking Discipline (R4-5)

Real data is always baked into `public/data/` at build time (zero external network
requests at runtime): the scripts have a built-in dual path of "fetch from public APIs +
committed snapshots" (offline reproducible); artifacts self-validate before being
written (value ranges / counts / scientific-sanity assertions, non-zero exit on
failure); `npm run bake:data` is idempotent (two runs produce byte-identical
artifacts); at runtime, artifacts are loaded and validated via `utils/bakedData.ts`,
falling back to the procedural path on failure.

## Testing Requirements

- Core business logic must have unit tests; physics functions must be fully covered
- **Coverage gate ≥90%** (enforced by the jest config; CI fails below threshold)
- New pure functions in utils target 100% coverage
- Scientific-sanity data checks are also written as unit tests (e.g. orbital-parameter
  ranges, texture-manifest file existence)

## Dev Preview Harness (/dev/preview)

A standalone single-body rendering verification page (R4-1) that skips the main scene
and mounts the target component directly:

```
http://localhost:3100/dev/preview?body=orion-nebula   # Volumetric nebula
http://localhost:3100/dev/preview?body=blackhole-test # Black-hole gravitational lensing
http://localhost:3100/dev/preview?body=m31            # Imagery-driven galaxy close-up (with volumetric dust disk)
http://localhost:3100/dev/preview?body=m87            # M87 environment + EHT zoom-in preset
```

Entries are registered in `utils/devPreview.ts` (20+ bodies: stellar surfaces /
volumetric nebulae / black holes / star clusters / galaxies / quasars / the Antennae /
lensing clusters / GRBs ...); each entry has ≤8 tuning sliders (per-frame getter reads
go straight to uniforms with zero rebuilds) + HUD readouts for performance and volume
quality tier (including a forced-tier slider for A/B comparison).

## Visual Verification (headless Chrome)

UI/rendering changes require visual verification in headless Chrome with screenshots
recorded:

```bash
# dev server (do not occupy 3000, reserved for user testing; dev:3100 uses a separate build dir and can run in parallel)
npm run dev:3100

# Headless Chrome (macOS)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-angle=metal --window-size=1280,800 \
  --remote-debugging-port=9222 about:blank
```

Drive it via CDP (`http://127.0.0.1:9222/json`): `Input.dispatchKeyEvent` to simulate
keys (`1`–`4` to switch views), `Runtime.evaluate` to assert against the DOM,
`Page.captureScreenshot` to capture and compare screenshots; the dev hooks
`window.__simStore` (Zustand store) and `window.__detailLayerDebug` (detail-layer
holders / GPU memory) are available for scripted assertions.

## Performance Budgets

| Metric | Target |
|---|---|
| Frame rate | Never drops below 60 FPS (volume rendering falls back via FPS-adaptive tier downgrades) |
| Polygons per scene | ≤1,000,000 |
| Texture resolution | ≤4096×4096 (3D density textures ≤128 per dimension) |
| Memory | <1 GB (measured: ~50 MB heap after GC during an L4 tour) |
| Detail-layer GPU memory | Four-pool GPU estimate ≤64 MB (LRU releases are accounted for) |
| Baked artifacts | `public/data/` total ≤15 MB (currently ≈2.5 MB) |
| Initial load | <5 seconds (models / 4K textures / baked close-up data lazy-loaded) |

## Workflow (AGENTS.md summary)

1. No direct commits to `master`; confirm the branch strategy before making changes
2. Implement → test → performance check → update `CHANGELOG.md [Unreleased]` → commit
3. User-visible changes must be recorded in the CHANGELOG (categorized as Added/Fixed/Improved)
4. Scientific accuracy first; artistic liberties must be registered (see [science-notes.md](science-notes.md))

## Requirements Document Index

Internal requirements documents are archived under `docs/internal/`:

| Document | Contents |
|---|---|
| `../internal/REQUIREMENTS.md` | Main requirements (P0–P7 iterations, per-item implementation status) |
| `../internal/IMPROVEMENT_REQUIREMENTS*.md` | Improvement iterations and implementation-delta records per batch: R1–R3 (interaction/tours/event scopes), R4 (volume rendering/gravitational lensing/stellar physicalization/baking pipeline), R5 (imagery-driven galaxies/2MRS survey/M87 environment/Fermi bubbles) |
| `../internal/IMPROVEMENT_REQUIREMENTS_SOLAR.md` | Sun-focused iterations (S1–S4) |
| `CHANGELOG.md` | Full change history |
