#!/usr/bin/env bash
set -euo pipefail

demo_dir="${DEMO_DIR:-$HOME/Desktop/demos}"
output="$demo_dir/log-pose-console.mp4"
frames=(
  "$demo_dir/log-pose-console-overview.png"
  "$demo_dir/log-pose-console-compare.png"
  "$demo_dir/log-pose-console-explore.png"
  "$demo_dir/log-pose-console-detail.png"
)

for frame in "${frames[@]}"; do
  if [[ ! -f "$frame" ]]; then
    printf 'missing demo frame: %s\n' "$frame" >&2
    exit 1
  fi
done

ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 2.8 -i "${frames[0]}" \
  -loop 1 -t 2.8 -i "${frames[1]}" \
  -loop 1 -t 2.8 -i "${frames[2]}" \
  -loop 1 -t 2.8 -i "${frames[3]}" \
  -filter_complex "
    [0:v]scale=1920:896:force_original_aspect_ratio=decrease:out_range=tv,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x211922,setsar=1,fps=30,trim=duration=2.8,setpts=PTS-STARTPTS[v0];
    [1:v]scale=1920:896:force_original_aspect_ratio=decrease:out_range=tv,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x211922,setsar=1,fps=30,trim=duration=2.8,setpts=PTS-STARTPTS[v1];
    [2:v]scale=1920:896:force_original_aspect_ratio=decrease:out_range=tv,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x211922,setsar=1,fps=30,trim=duration=2.8,setpts=PTS-STARTPTS[v2];
    [3:v]scale=1920:896:force_original_aspect_ratio=decrease:out_range=tv,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x211922,setsar=1,fps=30,trim=duration=2.8,setpts=PTS-STARTPTS[v3];
    [v0][v1]xfade=transition=fade:duration=0.4:offset=2.4[x1];
    [x1][v2]xfade=transition=fade:duration=0.4:offset=4.8[x2];
    [x2][v3]xfade=transition=fade:duration=0.4:offset=7.2,format=yuv420p,setparams=range=limited[outv]
  " \
  -map "[outv]" -an -c:v libx264 -preset medium -crf 18 \
  -pix_fmt yuv420p -color_range tv -movflags +faststart -t 10 "$output"

ffprobe -v error -show_entries format=duration \
  -show_entries stream=codec_name,width,height,pix_fmt,color_range,r_frame_rate \
  -of default=noprint_wrappers=1 "$output"
printf '%s\n' "$output"
