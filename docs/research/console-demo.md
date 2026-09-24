# research console demo

Capture these real interface states at the browser's natural 1960 × 915 screenshot size:

1. `log-pose-console-overview.png`: 2024 overview with the public-company ranking and selected inspector visible.
2. `log-pose-console-compare.png`: compare route with two public companies pinned and exact filing rows visible.
3. `log-pose-console-explore.png`: explore route with a useful query such as `Weaviate` and the source filters visible.
4. `log-pose-console-detail.png`: a selected company evidence inspector with dated source cards visible.

Save the screenshots in `~/Desktop/demos`, then run `scripts/make_console_demo.sh`. The script fits each real frame into a 1920 × 1080 plum canvas, uses short dissolves, and writes a silent ten-second H.264 MP4 beside the captures.
