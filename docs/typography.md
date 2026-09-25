# typography

log pose uses two voices. the interface uses the locally served Manrope variable font, with its SIL Open Font License retained in `web/fonts/`. literal source metadata uses the platform's UI monospace. the distinction indicates authorship and provenance, never evidence quality or certainty.

| role | treatment | use |
| --- | --- | --- |
| display | sans, responsive 38–72 px, weight 520, 1.08 leading, tight spacing | the atlas title; one primary heading per surface |
| title | sans, 24–36 px, weight 480–550, 1.15–1.2 leading | selected candidate and evidence inspector |
| reading | sans, 14 px, weight 450, 1.65 leading | explanations and analytical prose |
| control | sans, 13 px, weight 500–650, 1.35–1.45 leading | navigation, search, actions and ledger names |
| caption | sans, 12 px, weight 450–650, 1.5–1.65 leading | scope, legends, observation status and limits |
| source | monospace, 11–12 px, normal weight, 1.65 leading | source timestamps, exact categories, occurrence IDs, commit identifiers, artifact hashes and literal excerpts |

small labels are not automatically source material. labels such as “new in slice” remain sans-serif because they are the interface's interpretation. exact retained strings and their locators use mono. source links remain interface actions. numbers use tabular figures where comparisons matter; numerical counts do not need a change of typeface.

the large title carries expression; evidence prose favors comfortable line length. long hashes wrap instead of widening the inspector. graph labels are compact and progressively disclosed; the accessible candidate/edge list carries the full readable names. on narrow screens, the display scale reduces and text inputs remain 16 px to avoid automatic mobile zoom. typography does not rely on all-caps, italics, or color alone to separate evidence states.

tokens and role mappings live in `web/graph-workspace.css`. the scope of this system includes the atlas, its tools and the supporting evidence tables. experimental pages remain independently styled under their separate entrypoint.
