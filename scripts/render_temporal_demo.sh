#!/usr/bin/env bash
set -euo pipefail
# Four real browser captures; see docs/temporal-atlas-verification.md for the route/actions.
frames="${1:?capture directory required}"
output="${2:?output mp4 required}"
ffmpeg -y -loglevel error \
  -loop 1 -framerate 30 -t 2.5 -i "$frames/01-overview.png" \
  -loop 1 -framerate 30 -t 2.5 -i "$frames/02-neighborhood.png" \
  -loop 1 -framerate 30 -t 2.5 -i "$frames/03-connection.png" \
  -loop 1 -framerate 30 -t 2.5 -i "$frames/04-source-row.png" \
  -filter_complex "[0:v]scale=3840:1792,zoompan=z='1+on*0.00015':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x896:fps=30,setsar=1[a];[1:v]scale=3840:1792,zoompan=z='1+on*0.00015':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x896:fps=30,setsar=1[b];[2:v]scale=3840:1792,zoompan=z='1+on*0.00015':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x896:fps=30,setsar=1[c];[3:v]scale=3840:1792,zoompan=z='1+on*0.00015':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x896:fps=30,setsar=1[d];[a][b][c][d]concat=n=4:v=1:a=0,format=yuv420p[v]" \
  -map "[v]" -t 10 -c:v libx264 -pix_fmt yuv420p -color_range tv -crf 18 -preset medium -movflags +faststart "$output"
