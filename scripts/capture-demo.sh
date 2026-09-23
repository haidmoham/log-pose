#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
output="${1:-$HOME/Desktop/demos/log-pose-local-preview.mp4}"
preview_url="${LOG_POSE_PREVIEW_URL:-http://127.0.0.1:8000/}"
raw="${TMPDIR:-/tmp}/log-pose-local-preview-raw.webm"
mkdir -p "$(dirname "$output")"
browser=(npx -y agent-browser)

"${browser[@]}" set viewport 1080 1350
"${browser[@]}" record start "$raw" "$preview_url"
"${browser[@]}" wait --load networkidle
sleep 1
"${browser[@]}" click '.company-card:first-child .coverage-button:last-child'
"${browser[@]}" wait --load networkidle
sleep 2
"${browser[@]}" select '#cutoff' 2021
"${browser[@]}" wait --load networkidle
sleep 2
"${browser[@]}" click '#clear-selection'
sleep 1
"${browser[@]}" record stop
"${browser[@]}" close

raw_duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$raw")"
time_scale="$(awk -v duration="$raw_duration" 'BEGIN { printf "%.6f", 10 / duration }')"
ffmpeg -y -loglevel warning -i "$raw" -vf "setpts=PTS*$time_scale,fps=30,scale=1080:1350:flags=lanczos,format=yuv420p" -t 10 -an -c:v libx264 -crf 20 -preset medium -movflags +faststart "$output"
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 "$output"
