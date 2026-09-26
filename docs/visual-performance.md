# Visual performance profile

This profile compares reference commit `5d6eca7` with the visual-performance changes on the same local machine and browser. The opt-in harness is `web/experimental/visual-performance.html`; it is not linked from the product.

## Fixture and method

- Browser: Chrome 153 in the Codex in-app browser, visible and foreground.
- Host: AMD Ryzen 7 5800X, 31.9 GB memory.
- Browser viewport: 1440 × 1000 CSS pixels at device pixel ratio 1.
- Graph fixture: 1000 × 680 CSS pixels.
- Evidence fixture: retained CNCF 2024 accumulated frame from build `0c15e1ce1a92738173af8d94f7f89a2175d5c267f93e87f35a2b3ec01756d338`.
- Dense overview: 852 nodes and 2,500 loaded context edges from 35,870 total edges.
- Focused view: Datadog candidate `4d9ade2bfb2aa6cb4afb`, 61 nodes, 60 direct edges, and 1,574 context edges.
- Each report contains five trials. Each orbit uses 24 fixed pointer steps after a 1.1-second settle. Initial render honors reduced motion; orbit motion is explicitly enabled.

The harness measures synchronous render time, pointer-handler CPU time, consecutive animation-frame intervals, long tasks, projection calls, DOM writes, live-parent node insertions, and GPU updates. A frame interval includes rendering and browser scheduling; it is not a guaranteed frame rate or a physical-device result. The instrumentation itself adds cost, so the comparison uses identical instrumentation and workload.

## Result

| Measure | Baseline | Optimized | Change |
| --- | ---: | ---: | ---: |
| dense overview render, median | 100.0 ms | 67.8 ms | 32% lower |
| dense orbit frame interval, median | 147.2 ms | 64.8 ms | 56% lower |
| dense orbit frame interval, p95 | 182.5 ms | 88.2 ms | 52% lower |
| focused orbit frame interval, p95 | 29.4 ms | 6.0 ms | 80% lower |
| pointer handler CPU, median | 0.1 ms | 0.1 ms | unchanged |
| SVG attribute writes, median trial | 606,494 | 174,345 | 71% fewer |
| live-parent node insertions, median trial | 38,072 | 15,247 | 60% fewer |
| GPU updates, median trial | 68 | 12 | 82% fewer |
| maximum observed long task | 408 ms | 263 ms | 36% lower |

All 115 sampled dense orbit intervals still exceeded 20 ms. The optimized overview is meaningfully faster, but it does not sustain 60 frames per second at this density. The remaining cost is primarily projecting and writing 852 SVG node positions while the 3d camera moves.

The evidence, companies, and sources routes received one same-origin iframe load-and-scroll smoke profile per report. Companies and sources stayed near one refresh interval while scrolling. Evidence had one 176.7 ms baseline outlier; the optimized smoke did not repeat it. One pass cannot establish a route-level improvement, so these observations are regression coverage rather than a performance claim.

## Changes driven by the profile

- Suspend the hidden 2d WebGL renderer while 3d is active. This stops redundant buffer rebuilds, draws, and its animation loop.
- Cache gesture bounds instead of forcing a layout read on every pointer move.
- Keep the dense context mesh hidden and defer its endpoint writes only while an orbit is moving. Nodes, labels, and direct selected edges remain live. The complete mesh is reprojected and restored after damping settles, cancellation, a mode switch, or a reduced-motion update.
- Skip positional projection on 2d camera updates when node positions have not changed.
- Use a spatial index for exact label-overlap checks instead of scanning every already placed label.

Raw reports are retained in `docs/performance/visual-performance-baseline.json` and `docs/performance/visual-performance-after.json`. A discarded early run is intentionally excluded because its GPU instrumentation wrappers accumulated across trials.
