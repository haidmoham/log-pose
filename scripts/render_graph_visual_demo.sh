#!/usr/bin/env bash
set -euo pipefail

# The manifests contain timestamped captures from the real in-app browser.
# Keep each shot's captured timing, then cut three shots into a ten-second demo.
capture_directory="${1:?capture directory required}"
output="${2:?output mp4 required}"

shot_filter="fps=30,scale=1440:1000:force_original_aspect_ratio=decrease"
shot_filter+=",pad=1440:1000:(ow-iw)/2:(oh-ih)/2:color=0x17141c,setsar=1"
shot_filter+=",tpad=stop_mode=clone:stop_duration=4,trim=duration=3.333333,setpts=PTS-STARTPTS"
filter="[0:v]$shot_filter[a];[1:v]$shot_filter[b];[2:v]$shot_filter[c]"
filter+=";[a][b][c]concat=n=3:v=1:a=0,format=yuv420p[v]"

ffmpeg -y -loglevel error \
  -f concat -safe 0 -i "$capture_directory/overview.ffconcat" \
  -f concat -safe 0 -i "$capture_directory/neighborhood.ffconcat" \
  -f concat -safe 0 -i "$capture_directory/connection.ffconcat" \
  -filter_complex "$filter" \
  -map '[v]' -t 10 -an -c:v libx264 -crf 18 -preset medium \
  -pix_fmt yuv420p -color_range tv -movflags +faststart "$output"

ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames \
  -show_entries format=duration -of json "$output"
