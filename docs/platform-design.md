# atlas-first research experience

the entry page begins with one labelled example: Datadog in the retained CNCF 2024 source, showing 24 of 145 exact neighbors. an explicit source, year, artifact, search, or mode keeps its requested scope instead of inheriting the example. warm paper, plum type, and restrained blue, mint, and coral accents keep the map central.

the standalone reviewed-claims page is retired. reviewed relationships now appear beside an explicitly mapped candidate or selected pair. a short claim card shows its meaning and publication date; scope, unknowns, source quotations, hashes, identifiers, and review history unfold on demand. a pair without an eligible claim does not inherit its focal candidate's claim count. inventory year and source-publication time remain separate.

the research desk retains evidence, companies, and sources. comparison appears after pinning a company, and its picker unfolds when needed. other maps are absent from primary navigation. old reviewed links resolve to mapped contextual evidence or a retained claim/index, with an explicit notice where an old snapshot or filter is not applied. inventory exports explicitly exclude contextual reviewed claims.

graph surfaces and labels cannot select text during a drag. evidence text outside the map remains selectable. camera gestures clear transient hover without losing persistent selection, and keyboard focus remains visible.

## verification

local checks pass: 59 atlas tests, 111 dashboard tests, 7 committed-asset deployment tests, and 125 Python tests. three atlas and 26 Python database-dependent checks are skipped locally; the required app-and-data-health CI supplies disposable PostgreSQL and audits skips. both immutable snapshot validators pass. browser smoke covers 14 checks, including exact legacy claim links and unavailable reviewed-build recovery. required CI and Vercel results are recorded on PR 22 for the final commit.

manual browser checks cover candidate and connection evidence, exact retained rows and claims, company pinning and comparison, source search, time navigation, scoped empty results, keyboard graph selection, and mobile list access. at a 390 px viewport the document measures 375 px wide. this is viewport emulation, not a physical-device audit. computed styles confirm graph/label text selection is disabled while the evidence inspector remains selectable; native drags finish without retained text selection.

independent review found no delivery-blocking issue in identity mapping, separate clocks/builds, stale-response guards, or legacy routing. its exact-claim coverage gap has a regression check. lint retains 18 errors and 7 warnings from existing code, down from the baseline of 20 and 8 after retiring old modules; no rules were weakened. canonical data, snapshot bytes, source hashes, and SQL are unchanged from main. retained-data health has six passing checks; semantic truth and prepared-clone database reconciliation remain explicitly not evaluated. passing software checks do not independently verify a source author's claims.

## demo reproduction

start `PORT=8092 node scripts/market_field_dev.js`. use the codex in-app browser at its normal desktop viewport. save real viewport screenshots outside git with `tab.screenshot({fullPage:false})`:

1. open `/`; wait for the Datadog example frame. keep the page at the top and save `01-atlas.png`.
2. select Elastic with the keyboard. reset the graph camera if needed, then focus the search field to bring the page header into view. save `02-connection.png`.
3. open the contextual claim's scope disclosure and scroll the inspector to its claim, publication date, and limits. retain the surrounding atlas and save `03-evidence.png`.

inspect captures before encoding. the encoder preserves viewport aspect ratio, pads to 16:9, and adds a subtle camera move to the real stills; it does not simulate application behavior.

```sh
bash scripts/render_platform_demo.sh /path/to/captures /path/to/log-pose-atlas.mp4
```

the cut is ten seconds at 30 fps, silent H.264/yuv420p, 1280 × 720. inspect frames 0, 99, 100, 199, 200, and 299. keep generated media outside git.
