#!/usr/bin/env bash
set -euo pipefail

# Capture the five real browser states as JPEG files in this directory first.
demo_dir="$HOME/Desktop/demos"
build_dir="$(mktemp -d)"
trap 'python3 -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$build_dir"' EXIT

for shot in companies evidence fundamentals market readiness; do
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -framerate 30 -i "$demo_dir/log-pose-$shot.jpg" -t 2.2 \
    -vf "scale=1920:896,pad=1920:1080:0:92:color=0xf2f1ea,format=yuv420p" \
    -r 30 -c:v libx264 -preset fast -crf 19 \
    "$build_dir/$shot.mp4"
done

ffmpeg -hide_banner -loglevel error -y \
  -i "$build_dir/companies.mp4" -i "$build_dir/evidence.mp4" \
  -i "$build_dir/fundamentals.mp4" -i "$build_dir/market.mp4" \
  -i "$build_dir/readiness.mp4" \
  -filter_complex \
  "[0:v][1:v]xfade=transition=fade:duration=0.25:offset=1.95[v1];\
[v1][2:v]xfade=transition=fade:duration=0.25:offset=3.90[v2];\
[v2][3:v]xfade=transition=fade:duration=0.25:offset=5.85[v3];\
[v3][4:v]xfade=transition=fade:duration=0.25:offset=7.80[v4]" \
  -map "[v4]" -t 10 -an -c:v libx264 -preset fast -crf 18 \
  -pix_fmt yuv420p -movflags +faststart \
  "$demo_dir/log-pose-dashboard.mp4"
