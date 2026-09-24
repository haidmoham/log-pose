# local dashboard demo capture

Build `web/dashboard.json` from the pilot database, then serve `web/` locally as described in the README. Use the actual browser-rendered dashboard at its default desktop viewport. Capture these five states as 1960 × 915 JPEG images in `~/Desktop/demos`:

1. `log-pose-companies.jpg`: Companies landing view, with cohort counts and the first comparison rows visible.
2. `log-pose-evidence.jpg`: Open Confluent in Companies and frame its four dated evidence cards.
3. `log-pose-fundamentals.jpg`: Public fundamentals, periods ending 2024, sorted by revenue growth.
4. `log-pose-market.jpg`: Market activity with the three Cboe measures visible.
5. `log-pose-readiness.jpg`: Data readiness with coverage counts and the question table beginning to show.

Run `bash scripts/make_dashboard_demo.sh`. The script assembles a silent ten-second, 1920 × 1080, 30 fps H.264 video at `~/Desktop/demos/log-pose-dashboard.mp4`. The screenshots and finished video stay outside Git. No external posting is part of this command.
