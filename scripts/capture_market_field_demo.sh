#!/usr/bin/env bash
set -euo pipefail

# Use an isolated, explicitly authorized browser session. No microphone or posting.
preview_url="${1:-http://127.0.0.1:8080}"
demo_directory="${2:-$HOME/desktop/demos}"
mkdir -p "$demo_directory"
capture_directory="$(mktemp -d "${TMPDIR:-/tmp}/log-pose-market-demo.XXXXXX")"
browser=(npx --yes agent-browser --session "${MARKET_DEMO_SESSION:-log-pose-market-demo}")

"${browser[@]}" set viewport 1440 1100
"${browser[@]}" open "$preview_url/?view=topology"
"${browser[@]}" wait '.field-dot'
"${browser[@]}" eval 'window.scrollTo(0, 290)'
"${browser[@]}" record start "$capture_directory/market-field.webm"
"${browser[@]}" wait 2200
"${browser[@]}" click '.field-dot[data-candidate-id="004c9f6b7ecc1c48c8e4"]'
"${browser[@]}" wait '.field-observation'
"${browser[@]}" eval 'window.scrollTo(0, 290)'
"${browser[@]}" wait 2500
"${browser[@]}" click '.field-dot[data-candidate-id="30e05171b7a1b357ee44"]'
"${browser[@]}" wait '.field-shared-placement'
"${browser[@]}" eval 'window.scrollTo(0, 460)'
"${browser[@]}" wait 3000
"${browser[@]}" record stop

capture_seconds="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$capture_directory/market-field.webm")"
ffmpeg -hide_banner -loglevel error -y -i "$capture_directory/market-field.webm" \
  -t 10 -vf "setpts=(10/$capture_seconds)*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration=1,scale=1440:1100:force_original_aspect_ratio=decrease,pad=1440:1100:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -crf 19 -pix_fmt yuv420p -an -movflags +faststart \
  "$demo_directory/log-pose-market-field.mp4"
ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate \
  -show_entries format=duration -of json "$demo_directory/log-pose-market-field.mp4"
printf 'raw capture retained at %s\n' "$capture_directory/market-field.webm"
