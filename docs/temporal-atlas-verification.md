# temporal atlas verification

## scope and interpretation

the atlas is the default route. select a provider/year, inspect a candidate neighborhood, select a co-listing, and open either retained source row. snapshot and accumulated evidence retain exact provider/year/category joins; inventory time never becomes business-event time. additions and absences describe retained observations. candidates remain unresolved identity leads, and reviewed claims remain a separate present-day view.

the visual direction combines a dark plum workspace, a luminous graph, locally served sans typography, literal-source mono, and a restrained slab main heading. node anchors are computed once for the pinned build. collision relaxation targets separation rather than encoding strength. entering a neighborhood fits its camera; changing its year preserves the camera and anchors. graph distance, brightness and size are display choices. the API owns topology and changes; the browser owns display and interaction.

## checked locally on 2026-09-25

- `npm run test:dashboard`: 82 tests passed, including exact temporal joins, accumulated evidence, coverage gaps, filters, reproducible frames, deep links, out-of-order responses, route departure, selected identifiers, and reduced-motion single stepping.
- `node --test tests/deployment-health.test.mjs`: 6 passed after integrating the CI changes from `main` through `33e6274`.
- `PYTHONPATH=src python3 -m pytest -q tests/test_market_field_graph.py`: 5 passed.
- `PYTHONPATH=src python3 scripts/check_data_health.py`: 6 checked, 0 failed, 2 explicitly not evaluated: semantic truth and prepared-database reconciliation.
- `npm run build:market-field`: graph and fixed-layout rebuilds have no diff. CI now checks both artifacts. Its first Linux run caught floating-point drift in the layout; version 3 quantizes every integration step and uses explicit square-root distances, while retaining the exact-byte gate.
- Chrome, explicitly authorized after the in-app browser was unavailable: WebGL rendering, overview → Vespa → Dragonfly, keyboard selection, exact supporting rows and source hash, backward/forward year stepping with unchanged camera and retained selection, a missing 2019 stop, and no captured runtime errors.
- The actual backward step revealed a classification defect: Dragonfly has no support in either 2023 or its comparator. This now retains the identifier with an explicit unsupported state instead of implying a removal. A regression test covers it.
- Browser viewport override did not change the measured 1960 px viewport. Narrow-screen visual verification is not claimed. Reduced-motion behavior is tested through the route harness; OS-level media emulation is not claimed.

## motion review

| before | after | why |
| --- | --- | --- |
| every scrub rebuilt the route and range | persistent controls (`web/app.js:211`, `web/temporal-topology-view.js:147`) | native dragging and keyboard focus survive asynchronous updates |
| loading removed the graph and inspector | retain the dated frame; swap accepted evidence together (`web/temporal-topology-view.js:83`, `:514`) | no blank flash or old evidence presented as a new year |
| a missing frame shortened the page | reserve the desktop frame footprint and stop label (`web/graph-workspace.css:262`) | the time rail stays in one place |
| ordinary wheel input zoomed the graph | page scroll by default; modified wheel/pinch zoom (`web/temporal-graph.js:241`) | page navigation stays predictable |
| frequent focus/highlight changes eased | immediate scroll and edge highlights (`web/console.css:53`, `web/temporal-graph.css:20`) | no accumulated delay during repeated actions |

**approve:** no remaining material motion regression found in the reviewed desktop flow. real Chrome dragging reached 2020 from 2025 and reversed to 2025 with the same focused range, camera transform, scroll offset, and rail position. keyboard stepping preserved focus. the final missing-2019 and accepted-2020 rail both measured document y = 1069.96875 px. normal page scrolling was verified without graph zoom.

The route harness covers range identity, rapid reversal and out-of-order responses, retained pending evidence, failed targets and retry, missing stops, route exit, build refresh, terminal inventory failures, and reduced-motion single stepping. Three accepted frames are cached; there is no speculative prefetch or interpolated evidence. Full rendered frame-rate profiling and narrow-screen visual checks remain unclaimed.

## response measurements

[`evidence/temporal-frame-measurements.json`](evidence/temporal-frame-measurements.json) contains the exact build, frame IDs, 28 retained provider/year/mode responses and five neighborhood trials. Largest uncompressed response body: 369,635 bytes. Vespa 2024 neighborhood: 52,084 bytes and 1.58–4.20 ms over local HTTP in this run. These timings include the local query and transfer. They exclude production network conditions and are not GPU frame-rate measurements.

Repeat against an independently started local preview:

```sh
PORT=8156 node scripts/market_field_dev.js
node scripts/measure_temporal_frames.js http://127.0.0.1:8156 /tmp/temporal-frame-measurements.json
```

## cleanup and lint boundary

Astra reviewed and Sol implemented a bounded route refactor; Luna installed the local Oxlint plugin. Shared navigation callbacks replace repeated route-reset code. Explicit temporal activation/disposal prevents delayed responses painting another view and stops playback on departure. Incomplete neighbor links, committed search text, and no-comparison copy have focused tests. No analytical route, evidence validator, source record, or required gate was removed.

Oxlint 1.85.0 and `@oxlint/plugins` 1.85.0 are local development dependencies. All generic anti-slop rules are enabled at error. `npm run lint` reports existing runtime `typeof` checks at external-data and browser/Node boundaries; this lint run is not green. The checks remain where removing them would weaken input validation or runtime compatibility. No suppression or rule weakening was used. See [tooling/anti-slop.md](tooling/anti-slop.md). This separate diagnostic command is not represented as a passing CI gate.

## demo capture and reproduction

The delivered MP4 is a composed sequence of actual Chrome captures, not a real-time interaction recording. It is 10 seconds, 1920×896, 30 fps, H.264/yuv420p, silent, with gentle editorial zoom. The full graph aspect ratio is preserved.

Capture four normal 1960×915 viewport images with the authorized browser tool, named:

1. `01-overview.png`: `/`, LF AI 2024 overview.
2. `02-neighborhood.png`: keyboard-select the `explore Vespa` graph node.
3. `03-connection.png`: keyboard-select `inspect Dragonfly, newly observed in selected slice`.
4. `04-source-row.png`: choose `Dragonfly: Dragonfly · inspect retained row`.

The last row has ID `793fc312c419b37f8e2d` and artifact hash `22915df88f4e3b18f28563445baeb22bceb446763774015edcf74b788480adb8`. Keep captures outside Git. Render with:

```sh
bash scripts/render_temporal_demo.sh /tmp/log-pose-issue5-demo ~/desktop/demos/log-pose-temporal-atlas.mp4
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,pix_fmt -of json ~/desktop/demos/log-pose-temporal-atlas.mp4
```

Numeric metadata and representative encoded frames were inspected. Posting remains the user's action. Production publication and prepared-clone reconciliation are separate from this local verification.
