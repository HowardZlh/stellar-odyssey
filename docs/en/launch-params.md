# Launch URL Parameters

> 中文原版 / Chinese original: [../launch-params.md](../launch-params.md)

Stellar Odyssey can be configured at launch via URL query parameters -- enabling **deep-link sharing, kiosk deployment, partner branding, and language presets** without touching any code. All parameters can be freely combined; **invalid values silently fall back to defaults** and never raise errors.

```
https://stellar.guushu.com/?mode=kiosk&tour=all&dwell=30&logo=https://example.com/logo.png&lang=en
```

## Parameter Overview

| Parameter | Valid values | Default | Description |
|---|---|---|---|
| `body` | Any body id | None | Automatically fly to and follow the body once loading completes (invalid ids are silently ignored) |
| `mode` | `kiosk` | None | Enter kiosk mode (automatic tour, see below) |
| `tour` | `solar` / `galaxy` / `universe` / `all` | `solar` | Tour domain for kiosk mode |
| `dwell` | Integer `5`–`600` | `30` | Dwell time per stop in kiosk mode, in seconds (includes the ~2.5s camera move; out-of-range values are not clamped, they fall back to 30) |
| `logo` | https URL (≤2048 chars) | None | Shows a partner logo in the right-side corner of the page (max 160×40; hidden automatically if it fails to load) |
| `lang` | `zh` / `en` | — | UI language (priority: `?lang=` > local storage > default zh) |

`mode` / `tour` / `lang` are case-insensitive; if a parameter appears multiple times, the first value wins.

## Deep Links (`body`)

Share a link that flies straight to the target body and starts following it:

```
?body=jupiter        # Jupiter
?body=sgr-a-star     # The Sagittarius A* black hole (keep scrolling in to see the photon ring)
?body=orion-nebula   # The Orion Nebula (zoom in to dive inside the volume rendering)
?body=m31            # The Andromeda Galaxy
```

Body ids match those in the info panel / tour sequences (planets use lowercase English names; for notable bodies see data files such as `src/data/specialBodies.ts`). The fly-to triggers after the first batch of textures loads (with a 3-second fallback at the latest) and runs only once.

## Kiosk Mode (`mode=kiosk`)

An unattended mode for science museum / exhibition hall displays:

```
?mode=kiosk                          # Default: tour the solar system domain, 30s per stop
?mode=kiosk&tour=all&dwell=20        # Cycle through all four domains, 20s per stop
?mode=kiosk&lang=en&logo=https://…   # English kiosk + partner logo
```

**Behavior**:

- On start, the entire UI is hidden and the app automatically flies stop by stop through the tour domain (reusing the same camera moves as manual touring)
- With `tour=all`, the four domains cycle **from the inside out**: planetary system → solar system → Milky Way → universe → repeat; domain transitions go through a two-step "domain overview anchor → first body of the domain" sequence
- **Any visitor interaction** (touch / scroll / keypress) pauses the tour and shows the UI for free exploration
- While paused, a badge appears at the top center: "🎪 Kiosk mode (paused, resuming in N seconds) · Exit" -- after **90 seconds** of inactivity the tour resumes automatically (hiding the UI and immediately advancing to the next stop); clicking "Exit" returns to normal mode
- Every interaction resets the 90-second countdown

**Two ways to enter**:

| Entry point | Fullscreen | Use case |
|---|---|---|
| "🎪 Start kiosk mode" button in the control panel | Requests fullscreen (silently degrades if the browser refuses) | On-site exhibits -- one click and you are in |
| `?mode=kiosk` URL | Does not request fullscreen (browser restriction: always refused without a user gesture) | Boot-on-startup / digital signage integration -- pair with a browser kiosk flag (e.g. Chrome `--kiosk`) for fullscreen |

## Partner Logo (`logo`)

```
?logo=https://example.com/logo.png
```

- Shown on the right side of the page (below the top-right HUD, above the bottom-right info panel), 40px tall, max 160px wide, proportionally scaled, non-interactive
- **Only the https protocol is accepted** (http / data / javascript are all rejected), with a 2048-character length limit
- Hidden automatically if the image fails to load, without any errors
- **The logo stays visible while kiosk mode hides the UI** (by design, for branding scenarios)

## UI Language (`lang`)

```
?lang=en    # English UI (interface, 3D body labels, and educational notes all switch)
?lang=zh    # Chinese UI
```

Priority: `?lang=` > the localStorage value (key `stellar-odyssey:locale`) > default Chinese. You can also switch at any time with the **zh / EN** buttons at the top of the control panel (switching persists immediately).

## Related Shortcuts

| Key | Function |
|---|---|
| `H` | Hide/show the entire UI (available in normal mode; while kiosk mode is active, keypresses are treated uniformly as "visitor input") |

See [controls.md](controls.md) for the full shortcut reference.
