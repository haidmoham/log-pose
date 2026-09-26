# atlas browser performance

the reproducible local run passed the frozen S0 interaction and stability
budgets. it used commit `dd58e0b320207f88e1c6108ae2e8b6d143d0a95f`,
inventory build `990c81ef7202ecab9a0c9bf8185c459537dd1d48d7981d2839a297ed242396b5`
and reviewed build `bb773ae69b9991bed00afcf39948e66660eb4d5d51b8037be174ef273d30e7e7`.
the inventory frame was `7a7ec70e3c0883408845f73da798c6c6fb74cc6ff2565ab8029ad3c804963f53`;
the reviewed frame was `73acebb67529aac73ec53ad0b668d98fbbf13dea384460f39620b6079b5d15c9`.

the raw passing receipt is
[browser-playwright-s0.json](research/issue11/browser-playwright-s0.json).
the [frozen protocol](research/issue11/browser-measurement-protocol.md) names
the question, controls and budgets. two failed receipts remain beside it:
one records host interference before the soak, and one records the harness
selection race that the multi-cycle control reproduced and fixed. neither
failed receipt is evidence for the passing result.

## latency and browser work

each cell is p50 / p95 from five fresh browser contexts. camera values combine
100 accepted inputs per workload and profile. the browser cache was disabled;
the local server and OS page cache were warm.

| profile and workload | graph ready | warm frame acceptance | zoom JS | pan JS |
| --- | ---: | ---: | ---: | ---: |
| desktop, inventory top 60 | 162 / 209 ms | 134 / 156 ms | 0.6 / 0.9 ms | 0 / 0.1 ms |
| desktop, inventory top 100 | 187 / 194 ms | 149 / 155 ms | 0.4 / 0.5 ms | 0 / 0.1 ms |
| desktop, reviewed | 130 / 139 ms | 94 / 98 ms | 0.1 / 0.2 ms | 0 / 0.1 ms |
| constrained, inventory top 60 | 1,003 / 1,019 ms | 530 / 565 ms | 2.9 / 4.2 ms | 0 / 0.6 ms |
| constrained, inventory top 100 | 1,085 / 1,116 ms | 522 / 532 ms | 1.9 / 3.2 ms | 0.1 / 0.6 ms |
| constrained, reviewed | 916 / 944 ms | 206 / 206 ms | 0.6 / 1.2 ms | 0 / 0.7 ms |

the constrained profile used 390 × 844, 4× CPU throttling, 80 ms latency and
1,000,000 bytes/s each way. desktop used 1440 × 1000. the maximum decoded API
response was 32,821 bytes. initial navigation plus resource timing ranged from
214,574 to 439,501 decoded bytes and 218,474 to 443,401 transferred bytes.
local HTTP used no content encoding. inventory top 60 and top 100 both used
the exact 145-neighbor frame; top 100 rendered 100 neighbors plus the focus.

## twenty-minute stability run

the soak ran for 1,200.365 seconds. one warmup and 18 timed cycles committed a
60→100 density change, changed the inventory year, inspected retained rows,
changed the reviewed publication cutoff, inspected full claims, then exited to
the same resting route. all 171 API reads and 1,064 total HTTP requests
completed. no request or page error occurred.

eleven two-minute, forced-GC resting samples ended 15,384 bytes below the
baseline JS heap. DOM node and event-listener counts had zero endpoint growth.
none of those metrics increased at every sample. peak isolated Chromium RSS
was 1,019,224,064 bytes; peak local Node/SQLite server RSS was 155,078,656
bytes. both stayed within the frozen limits.

## interpretation limits

the host was WSL2 on a Ryzen 7 5800X with 16 logical CPUs and about 16 GiB
available to Linux. Playwright 1.63.0 launched Chromium 153.0.8010.12. the
headless browser used SwiftShader and reported GPU compositing and WebGL as
unavailable. GPU memory and compositor completion were not measured. camera
numbers cover JavaScript accepted-frame work only.

these results establish local real-S0 behavior. they do not establish S1
browser performance, deployed cold starts, production latency, physical-phone
performance or hardware-GPU stability. cold browser contexts still shared a
warm server and OS page cache. the 1 MiB response limit is an API envelope;
application assets are reported separately.

the first short run also found that top 100 selected 100 neighbors but paged
only 60. commit `41fff0d` binds the visible focus page limit to `top_k`; its real
S0 regression renders 101 nodes including the focus. the retained
[pre-fix receipt](research/issue11/browser-top100-pre-fix.json) records the
coherent but misleading 60-of-145 frame before that correction.

run the benchmark locally with:

```bash
PLAYWRIGHT_ROOT=/tmp/playwright-1.63.0 node scripts/benchmark_atlas_browser.mjs \
  --samples 5 --soak-minutes 20 \
  --output docs/research/issue11/browser-playwright-s0.json
```

the harness accepts loopback HTTP only. it owns its browser and local server,
enforces request, response, RSS, report-size and wall-clock limits, and returns
a nonzero exit when a measured budget fails.
