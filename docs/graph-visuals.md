# company graph visual pass

## scope

the temporal atlas keeps its existing coordinates, inventory frames, source identifiers, and evidence meanings. this pass changes its light, focus response, and display controls. it does not change reviewed claims, acquire evidence, or alter the graph build.

the design separates fixed node cores from a soft atmospheric layer. the strongest warm light belongs to the current interaction. first-party interaction studies informed this relationship; no external artwork or implementation was copied. the palette and rendering are local to log pose. this is a trial of that visual idea, not a new evidence encoding.

population adds a brief staggered overshoot around each fixed anchor, settled within 960 ms. ordinary edge selection does not replay the whole entrance. reduced motion starts with graph motion off. the user can explicitly enable motion in view settings. hollow comparison markers remain hollow during entry and interaction.

## verification on 2026-09-25

- `npm run test:dashboard`: 89 passed. the suite includes unchanged anchors/camera, keyboard selection, local highlight scope, population replay rules, deferred GPU attachment, discarded scenes, reduced-motion opt-in, and disconnected animation cleanup.
- `npm run lint`: the existing 20 errors and 8 warnings remain. the modified graph modules have only their three pre-existing runtime `typeof` wrapper diagnostics. no validators or lint rules were weakened.
- actual in-app browser: CNCF overview with 852 candidates; Datadog neighborhood with 61 displayed nodes; New Relic keyboard selection and retained-row inspector; warm local connection response; no entrance replay on edge selection; motion off/on; no captured browser errors.
- a local synthetic SVG-only fixture confirmed that keyboard selection keeps the comparison marker hollow, its aura at zero opacity, and its reduced-motion entrance disabled. the fixture was removed after the check.
- mobile viewport measured 390 × 845, with document width 375 and graph width 313.46 px. zoom worked with no horizontal overflow. this is viewport emulation, not a physical-device claim.
- the delivered demo is 10.000 seconds, 300 output frames, 1440 × 1000, H.264/yuv420p. representative frames and both cut boundaries were inspected. no audio was requested.

## follow-up: spacing and inspection

focused neighborhoods use a 1.4× closer initial camera while keeping source anchors unchanged. peer context connections are opt-in in a focused neighborhood; direct focus connections remain visible. the overview keeps its context. see `graph-legibility.md` for the display contract.

node selection previously focused the inspector with the browser's default scrolling. a visible-node keyboard reproduction moved the page from about 732 px to 1,686 px. temporal selection now focuses with `preventScroll: true`. the route regression test verifies this for both candidate and connection selection. an actual pointer selection at a 541 × 982 viewport kept `scrollY` at 0 through the asynchronous response and still focused the inspector. automated locator focus can itself scroll a target into view; that is separate from the corrected application focus.

## demo reproduction

start the saved-export preview:

```sh
PORT=8083 node scripts/market_field_dev.js
```

use the codex in-app browser at a measured 1440 × 1000 viewport. open `/?view=topology`. if reduced motion is active, explicitly enable graph motion in view settings for the capture. inspect Datadog, then keyboard-select New Relic and focus its node to show the local response. capture the real viewport for about 3.4 seconds at each stop. use the browser screenshot API with an explicit `{x: 0, y: 0, width: 1440, height: 1000}` clip; the unrestricted screenshot path expanded this browser's viewport. save screenshots and their elapsed capture times outside git. each shot has an FFconcat manifest named `overview.ffconcat`, `neighborhood.ffconcat`, or `connection.ffconcat`. each manifest begins with `ffconcat version 1.0`, then repeats `file 'relative-image.png'` and `duration <seconds until next capture>`; repeat the final image once at the end.

the three shots show the overview, Datadog's neighborhood, and a selected co-listing. keep the evidence labels visible. encode with:

```sh
bash scripts/render_graph_visual_demo.sh /path/to/captures /path/to/log-pose-graph.mp4
```

the output is a silent 10-second H.264/yuv420p clip at 1440 × 1000 and 30 fps. the encoder preserves capture timing and aspect ratio. it may duplicate captured frames to meet the output frame rate; this is not a frame-rate benchmark. inspect representative frames and the two cut boundaries after encoding.
