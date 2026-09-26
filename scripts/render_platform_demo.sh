#!/usr/bin/env bash
set -euo pipefail

capture_directory="${1:?capture directory required}"
output="${2:?output mp4 required}"

# These are real browser stills. Remove only the capture surface's blank padding.
# The gentle camera move is an edit, not a claim about application animation.
shot="crop=1124:790:0:0,scale=2248:1580:out_range=tv"
shot+=",zoompan=z='1+0.0001*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=100:s=1124x790:fps=30,setsar=1"
filter="[0:v]$shot[a];[1:v]$shot[b];[2:v]$shot[c]"
filter+=";[a][b][c]concat=n=3:v=1:a=0,format=yuv420p[v]"

ffmpeg -y -loglevel error \
  -i "$capture_directory/01-atlas.png" \
  -i "$capture_directory/02-connection.png" \
  -i "$capture_directory/03-reviewed.png" \
  -filter_complex "$filter" -map '[v]' -t 10 -an \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -color_range tv \
  -movflags +faststart "$output"

ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames \
  -show_entries format=duration -of json "$output"
