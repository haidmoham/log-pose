#!/usr/bin/env bash
set -euo pipefail

site_url="${1:-http://127.0.0.1:8080}"
demo_dir="${2:-$HOME/desktop/demos}"
capture_dir="$demo_dir/log-pose-captures"
mkdir -p "$capture_dir"

browser() { npx --yes agent-browser "$@"; }
browser set viewport 800 1000

browser open "$site_url/"
browser record start "$capture_dir/01-research-desk.webm" --fps 30
browser wait 700
browser click '.desk-toy-pendulum:nth-child(2)'
browser wait 400
browser click '.data-result'
browser wait 1300
browser record stop

browser open "$site_url/?dataFamily=market"
browser record start "$capture_dir/02-market.webm" --fps 30
browser wait 500
browser click '.data-result:last-of-type'
browser wait 1500
browser record stop

browser open "$site_url/?view=topology"
browser record start "$capture_dir/03-source-field.webm" --fps 30
browser wait 1000
browser click '.field-index-row'
browser wait 1400
browser record stop

ffmpeg -y -hide_banner -loglevel error \
  -i "$capture_dir/01-research-desk.webm" \
  -i "$capture_dir/02-market.webm" \
  -i "$capture_dir/03-source-field.webm" \
  -filter_complex '[0:v]trim=duration=4.7,setpts=PTS-STARTPTS,fps=30,scale=1080:1350,format=yuv420p[v0];[1:v]trim=duration=3.8,setpts=PTS-STARTPTS,fps=30,scale=1080:1350,format=yuv420p[v1];[2:v]trim=duration=3.8,setpts=PTS-STARTPTS,fps=30,scale=1080:1350,format=yuv420p[v2];[v0][v1][v2]concat=n=3:v=1:a=0[out]' \
  -map '[out]' -c:v libx264 -preset medium -crf 19 -movflags +faststart \
  "$demo_dir/log-pose-research-desk.mp4"

browser close
printf '%s\n' "$demo_dir/log-pose-research-desk.mp4"
