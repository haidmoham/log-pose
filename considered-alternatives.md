# considered alternatives

## graph renderer

the chosen direction is a two-dimensional WebGL atlas with accessible page controls and an SVG interaction/label layer. the user approved WebGL on 2026-09-25. graph eligibility, pair construction, temporal comparison and provenance stay in the server query layer. graphics cannot create evidence.

| option | why consider it | decision and revisit trigger |
| --- | --- | --- |
| SVG throughout | native focus, text, inspection and straightforward tests; useful for small neighborhoods | retained as the no-WebGL fallback. revisit as the primary renderer if measured GPU/label complexity outweighs its benefit at the real graph size. |
| canvas 2d | small implementation surface and good control over a moderate-sized graph | keep available if WebGL availability or maintenance becomes the limiting factor. it still requires a separate accessible representation and hit testing. |
| WebGL geometry + accessible DOM/SVG | batched lines and luminous points; independent controls and evidence; fits a graph-centered experience | selected. inspect GPU output, fallback, context loss, resize, zoom and frame atomicity. GPU rendering does not by itself prove faster interaction. |
| PixiJS | a maintained 2d scene graph, rendering and accessibility facilities | plausible replacement if the renderer grows substantially. the current scene needs only points and lines; reuse the repository's small WebGL pattern before adding a scene-graph dependency. |
| Three.js / a spatial 3d graph | existing reviewed topology has a small WebGL implementation; 3d permits spatial exploration | not selected for the temporal atlas. depth, occlusion and rotation complicate comparison without an evidence-backed third dimension. retain the separate reviewed view. |
| continuous browser force simulation | familiar organic settling, as in many graph tools | rejected for time stepping: motion can obscure evidence changes, and camera/node stability matters. use deterministic build-time relaxation and retain those anchors throughout the pinned build. |

WebGL is the rendering API, not the data model or application framework. the current hybrid keeps graph interactions independently testable and retains a readable alternative when the GPU path fails.

## navigation and time

three lightweight arrangements were considered: a timeline above a stable map; two equal side-by-side graphs; and a change-ledger-first interface. the chosen flow is atlas → neighborhood → exact evidence, with a discrete year rail and a linked change ledger. side-by-side maps divide attention and duplicate controls; a ledger-first page hides the graph's structure. a comparison frame remains explicit in the chosen flow.

snapshot means rows in one retained provider/year slice. accumulated evidence means previously observed exact placements through a chosen inventory year. neither mode asserts current relationship validity. empty or failed frames replace the graph rather than reusing old evidence under a new date.

## visual direction

[Obsidian's graph](https://obsidian.md/help/plugins/graph) informs overview-to-neighborhood navigation, fine connections, zoom, label disclosure, and local focus. it does not supply our relationship semantics, node-size metric, or time clock.

[mhaider.dev](https://mhaider.dev/) informs generous typography, fine rules, and the contrast between an editorial surround and an interactive field. the final surround returns to dark plum at the user’s request. its separation of stable subject and expressive light becomes a small local selection halo around actual graph nodes. there are no invented background nodes and no glow-as-confidence encoding.

[Red Blob's interaction notes](https://www.redblobgames.com/making-of/little-things/) inform continuity, enlarged hit areas and linked emphasis. [Tangle](https://worrydream.com/Tangle/) informs immediate local controls. label density and thread visibility change presentation only. all implementation is project-specific; no private design-library content or third-party assets are copied into this public note.

## boundaries

experimental ML studies remain in `experiments/ml/` and the separate `web/experimental/` entrypoint. the atlas's supporting evidence and analysis routes do not silently promote those studies into the canonical console. reviewed claims stay a distinct present-day view until a compatible historical clock is available.
