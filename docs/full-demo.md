# full atlas walkthrough

the 68-second silent cut shows the live product at production commit
`370b0769cf81845c8ff4dddb3a614b6ef685a5dc`. source captures and the finished
`log-pose-full-demo.mp4` live outside git in
`C:/Users/haidm/Desktop/demos/log-pose-full`.

## capture

use the permitted codex in-app browser and a separate tab at
`https://logpose.mhaider.dev/`. keep its normal desktop viewport. these captures
were 1266 × 712 pixels. wait for a visible graph before recording, and observe
the page after each action. use the actual graph, controls, and records; do not
replace the renderer with an animation or modify application state through eval.

capture `tab.screenshot({fullPage:false})` in a loop while the browser actions run.
record each screenshot's completion timestamp relative to the shot's start.
aim for a 50 ms interval; the observed capture rate was about 15–16 frames per
second. preserve elapsed time in an FFmpeg concat manifest. output is resampled
to 30 fps, with no invented intermediate camera positions.

write each screenshot buffer unchanged to a numbered file and add a manifest
entry using the next timestamp minus the current one:

```text
ffconcat version 1.0
file '00000.png'
duration 0.063000
file '00001.png'
duration 0.062000
```

repeat the last file after its final duration. screenshot bytes are JPEG even
when the capture path ends in `.png`; FFmpeg detects the byte format. retain
the original captures. navigation can change their pixel format, so the encoder
keeps one continuous filter clock instead of restarting timing at navigation.

| folder | seconds | actual actions, relative to shot start |
| --- | ---: | --- |
| `01-orbit` | 8 | select 3d, reset, and focus the skip-to-atlas anchor before capture. at 0.7, 2.8, and 5 seconds, drag inside the graph to orbit in three directions. |
| `02-pan-and-2d` | 8 | begin in 3d. at 0.8 seconds select 2d. pan at 2, 3.8, and 5.5 seconds with offsets of (-130, 25), (70, -55), and (65, 25) pixels. |
| `03-search` | 7 | at 0.5 seconds enter Datadog; search at 1.3 seconds; activate the exact `explore Datadog` graph button with Enter at 3.4 seconds. |
| `04-time` | 9 | with Datadog focused in CNCF 2024, previous year at 1 second, next year at 3.3 seconds, accumulated observation mode at 5.7 seconds. |
| `05-evidence` | 12 | restore the 2024 snapshot and wait for that frame. inspect Elastic with Enter at 0.6 seconds; expand claim scope at 3.2 seconds; scroll the inspector at 5.3 seconds; open its retained claim at 8 seconds. |
| `06-companies` | 14 | begin in companies. inspect Datadog at 0.7 seconds and pin at 2.3; inspect Elastic at 4 and pin at 5.5; open compare at 7; select period-end year 2023 at 10.5. |
| `07-sources` | 10 | begin in sources. search Datadog at 0.7 seconds; filter record year 2024 at 2.8; at 5.2 open source records in the article whose heading is exactly Datadog and whose type is directory lead. |

derive each drag origin from the graph's current DOM bounding rectangle and
its visible intersection with the viewport. view switches and keyboard focus
can scroll the page; do not reuse coordinates from a previous layout. verify
there is no text selection before recording. keep a short reading hold after
each action and preserve the interface's source dates, evidence status, and
unknowns.

## encode and verify

run from WSL with the retained captures mounted at their existing location:

```sh
python3 scripts/render_full_demo.py \
  /mnt/c/Users/haidm/Desktop/demos/log-pose-full \
  /mnt/c/Users/haidm/Desktop/demos/log-pose-full/log-pose-full-demo.mp4
```

the encoder uses the product's bundled Bricolage font and paper/plum colors in
a separate caption rail. it preserves the full interface aspect ratio, adds
simple chapter cuts, and encodes H.264/yuv420p with faststart. no audio is captured.

the output validator checks exactly 2040 frames, 68 seconds within one frame,
1280 × 768 pixels, 30 fps, the expected codec/pixel format, and no audio stream.
`edit-receipt.json` records the chapter timings. `contact-sheet.png` shows the
first, middle, and final frame of every chapter, including both sides of every
cut. `orbit-contact-sheet.png` samples the opening camera sequence twice per
second. inspect these and preview the motion before delivery; changing pixels
alone do not establish a useful camera demonstration.
