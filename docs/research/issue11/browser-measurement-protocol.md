# atlas browser measurement protocol

## question and controls

does the bounded real S0 inventory route and the four-claim reviewed route meet
the interaction budgets without retained browser-state growth? this run does
not measure S1 browser behavior, production latency or a physical phone.

the harness launches Playwright 1.63.0's isolated Chromium and the local
Node/SQLite preview on loopback. it refuses non-loopback origins. each sample
records the git commit, immutable inventory and reviewed builds, accepted frame,
browser/runtime/hardware, viewport, throttle, cache state, response bytes and
content encoding. a fresh context disables the browser cache. the server and
OS page cache remain warm, so “cold” means a cold browser context only.

five samples cover inventory top 60, inventory top 100 and reviewed focus at
1440 × 1000. five more cover each workload at 390 × 844 with 4× CPU, 80 ms
latency and 1,000,000 bytes/s in each direction. warm focus changes measure
user action through a coherent frame accepted by both the graph and inspector.
cold navigation to first graph-ready is reported separately. twenty pan and
twenty zoom inputs per sample report accepted-frame JavaScript work. this does
not measure compositor completion, FPS or GPU memory.

## budgets frozen before the run

- decoded interactive API response: at most 1 MiB.
- warm frame acceptance p95: 1 s desktop, 2 s constrained.
- cold-browser graph-ready p95: 2 s desktop, 5 s constrained.
- camera JavaScript p95: 33 ms desktop, 50 ms constrained.
- no frame/inspector mismatch, failed request or uncaught page error.
- at most 200 API reads per named measurement workload and 2,000 total HTTP
  requests. the soak has a separate ceiling of 180 API reads.
- harness wall clock: at most 24 minutes; Chromium descendants: at most 2 GiB;
  report: at most 100 MiB. the whole job targets less than 4 GiB RAM and 1 GiB
  disk, within the issue's 30-minute, 8 GiB and 20 GiB local tier.

the 20-minute soak repeats a deterministic inventory focus, committed density
change, inventory-year change, edge inspection, reviewed focus,
source-publication-cutoff change, claim inspection and route exit. cycles begin
on a 70-second cadence so the warmup plus timed work stays within 180 API reads. every two
minutes it returns to the same local lightweight route, settles, forces GC and
reads CDP heap and `Memory.getDOMCounters` values. final post-GC heap must be
within both 20 MiB and 15% of baseline. final DOM nodes must be within 50 and
event listeners within five of baseline. the report also flags metrics that
increase at every sample and preserves the full trend; endpoint and monotonic
checks serve different leak signals. OS/browser noise can make either imperfect.

server and browser-process RSS are sampled separately. WebGL/system details can
show whether a GPU path exists, but this harness cannot account for retained GPU
resources. GPU-memory stability therefore remains not evaluated.
