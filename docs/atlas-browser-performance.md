# atlas browser measurements

the new route loads a bounded frame and fetches retained premise rows on
selection. top-k defaults to 60, with a tested range of 1–100. camera input is
coalesced per animation frame; a pan reuses label visibility and changes the
camera transform. a zoom recomputes label collisions for the bounded frame.

raw samples are in [browser-local.json](research/issue11/browser-local.json).
those local samples precede integration of PR #12's renderer and shared pure
research model. retain them as measurements of that earlier state, not the
final asset size or render cost.
measurements use the Codex in-app Chromium browser on a Windows host with a
Ryzen 7 5800X, serving from WSL2. the browser did not expose its version or
CPU/network throttling controls. these are same-host reloads with a warm
SQLite process and warm OS cache, not deployed cold starts.

| measurement | 1440 × 1000 | 390 × 844, unthrottled |
| --- | --- | --- |
| graph-ready p50 / p95, five reloads | 55.8 / 71.3 ms | 62.2 / 103.6 ms |
| synchronous render p50 / p95 | 3.6 / 4.0 ms | 3.9 / 5.3 ms |
| zoom JS work p50 / p95, twenty inputs | 0.6 / 0.9 ms | 0.5 / 0.9 ms |
| pan JS work p50 / p95, twenty inputs | 0 / 0.1 ms | 0 / 0.1 ms |

the initial decoded HTML, scripts, styles and responses observed by first
graph-ready total at most 166,060 bytes. the focus response is about 33.7 kB.
the default Datadog focus draws 61 candidates from 145 eligible neighbors.
each measured reload had 748 DOM nodes. this is a snapshot count, not a leak
or long-session stability test. p95 uses the nearest-rank sample; five reloads
cannot characterize a production latency tail.

one later Postgres-backed browser load reached graph-ready in 118.1 ms with
5.1 ms synchronous render work and 166,739 decoded bytes. the selected Elastic
edge returned both exact retained rows from the same 2024 artifact. that one
smoke check is not a Postgres latency distribution.

after integrating PR #12, the protected Vercel preview passed the old-build
link, top-k 1/reset, exact retained-row navigation, matching frame/inspector
IDs, missing-build error and recovery checks in the user's authorized Chrome
session. one warm hosted load reached graph-ready in **356.7 ms**, with **6.9 ms**
synchronous render work, **244,061 decoded bytes** and **61 candidates**.
the added pure research model loads no corpus or evidence catalog. preview
assets and browser conditions differ from the earlier local samples; this is
not a controlled speed comparison. see [the deployed receipt](research/issue11/deployed-preview.json).

browser checks exercised source/year changes, the connection slider and exact
input, reset, keyboard zoom/pan, candidate and edge selection, retained rows,
list mode and narrow layout. unit checks also cover reduced motion, stale
responses, route disposal, bounded cache behavior and coherent frame labels.

## remaining performance claims

- the required 4× CPU, 80 ms latency and 1 MB/s profile has not been measured.
- camera timings measure JavaScript work, not full compositor frames or FPS.
- the twenty-minute retained-heap/GPU soak has not run.
- neither local profile proves Railway-to-Vercel latency or a physical phone's
  performance. retain these gaps until the matching measurements exist.

repeat the fixed route in the raw receipt, reload five times per viewport,
and read `#atlas-scene`'s `data-graph-ready-ms`, `data-render-ms`, and decoded-byte
attributes after the graph appears. issue twenty zoom and pan inputs and read
the graph's `data-camera-frame-ms` after each accepted frame. restore the
viewport after testing. these attributes are measurement aids, not evidence
or research-model inputs.
