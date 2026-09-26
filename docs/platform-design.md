# atlas-first research experience

the entry page begins with one explicitly labelled example neighborhood: Datadog in the retained CNCF 2024 source. it displays 24 of 145 exact neighbors. an explicit source, year, artifact, search, or mode keeps its requested scope instead of inheriting the example.

the atlas is the primary route. source context and evidence meaning stay visible while lists, display settings, exports, coverage, and audit metadata unfold on demand. the research desk retains evidence, company comparison, sources, and other maps. old console links still resolve. the palette uses warm paper, plum type, and restrained blue, mint, and coral accents.

this changes presentation and navigation. it does not reinterpret co-listing as competition, turn a hypothesis into a fact, or change canonical records. reviewed claims keep their own predicates, review basis, source-publication clock, scope, and unknowns. source hashes and retained row links remain inspectable.

## verification

local checks after integrating main's reviewed traversal work: 109 dashboard tests, 48 atlas tests, 7 deployment tests, and 125 Python tests pass. 3 atlas and 26 Python database-dependent checks are skipped locally; the required CI supplies disposable PostgreSQL and audits its test skips. both immutable snapshot validators pass. retained-data health reports six checks passed, with semantic truth and prepared-clone database reconciliation explicitly not evaluated.

the existing lint baseline is 20 errors and 8 warnings; no rules were weakened. the browser pass covers desktop selection, exact retained rows, reviewed claims, source trails, company evidence, comparison, scoped empty search, and mobile list access. at a 390 px viewport the document measures 375 px wide. this is viewport emulation, not a physical-device audit.

## demo reproduction

start `PORT=8092 node scripts/market_field_dev.js`. use the codex in-app browser with a 1280 × 900 viewport. save real viewport screenshots outside git using `tab.screenshot({fullPage:false})`:

1. open `/`; wait for the Datadog example frame. save `01-atlas.png`.
2. select Elastic. retain the exact shared-placement inspector. save `02-connection.png`.
3. follow “reviewed claims for Datadog”, select Elastic, and show the documented claim. save `03-reviewed.png`.

the capture surface used here returns a padded bitmap with the real viewport in its upper-left 1124 × 790 px area. inspect new captures before reusing the crop. the encoder removes that empty padding and adds a subtle camera move to the real stills; it does not simulate interface behavior.

```sh
bash scripts/render_platform_demo.sh /path/to/captures /path/to/log-pose-atlas.mp4
```

the cut is ten seconds at 30 fps, silent H.264/yuv420p, 1124 × 790. inspect the output at 0, 3.3, 3.4, 6.6, 6.7, and 9.9 seconds. keep generated video and frames outside git.
