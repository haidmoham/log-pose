#!/usr/bin/env python3
"""Encode timestamped in-app-browser captures. This script does not control a browser."""
import argparse
import json
import subprocess
from pathlib import Path


SHOTS = [
    ("01-orbit", 8, "orbit the atlas"),
    ("02-pan-and-2d", 8, "pan and switch to 2d"),
    ("03-search", 7, "find a candidate"),
    ("04-time", 9, "move through source time"),
    ("05-evidence", 12, "follow a connection to its evidence"),
    ("06-companies", 14, "pin companies and compare periods"),
    ("07-sources", 10, "inspect dated source records"),
]


def run(arguments):
    subprocess.run(arguments, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    captures = args.captures.resolve()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    font = Path(__file__).resolve().parents[1] / "web/fonts/bricolage-grotesque-variable.woff2"
    encoded = []
    chapters = []
    elapsed = 0
    for index, (name, seconds, label) in enumerate(SHOTS, 1):
        shot = captures / name
        manifest = shot / "capture.ffconcat"
        if not manifest.is_file():
            raise FileNotFoundError(manifest)
        caption = shot / "caption.txt"
        caption.write_text(f"{index:02d} / {label}", encoding="utf-8")
        target = shot / "encoded.mp4"
        # Keep the full UI above a separate caption rail; never cover source evidence.
        filters = (
            "setpts=PTS-STARTPTS,fps=30,"
            "scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos,"
            "pad=1280:768:(ow-iw)/2:0:color=0xf5f3ee,setsar=1,"
            "drawbox=x=0:y=720:w=1280:h=48:color=0xf5f3ee:t=fill,"
            f"drawtext=fontfile='{font}':textfile='{caption}':"
            "fontcolor=0x302838:fontsize=21:x=24:y=733,"
            f"drawtext=fontfile='{font}':text='log pose':"
            "fontcolor=0x326c68:fontsize=21:x=w-tw-24:y=733,"
            f"tpad=stop_mode=clone:stop_duration=1,trim=duration={seconds},format=yuv420p"
        )
        # Navigation can change a screenshot's pixel format. Keep the filter clock continuous.
        run(["ffmpeg", "-y", "-loglevel", "error", "-reinit_filter", "0", "-f", "concat", "-safe", "0",
             "-i", str(manifest), "-vf", filters, "-an", "-c:v", "libx264",
             "-preset", "medium", "-crf", "18", "-color_range", "tv",
             "-movflags", "+faststart", str(target)])
        encoded.append(target)
        chapters.append({"name": name, "label": label, "start_seconds": elapsed,
                         "duration_seconds": seconds})
        elapsed += seconds
    manifest = captures / "edit.ffconcat"
    manifest.write_text("ffconcat version 1.0\n" + "".join(
        f"file '{path.as_posix()}'\n" for path in encoded), encoding="utf-8")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", str(manifest), "-c", "copy", "-movflags", "+faststart", str(output)])
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)
    ], text=True))
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    assert video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
    assert (video["width"], video["height"], video["r_frame_rate"]) == (1280, 768, "30/1")
    assert int(video["nb_frames"]) == elapsed * 30
    assert abs(float(probe["format"]["duration"]) - elapsed) <= 1 / 30
    assert all(stream["codec_type"] != "audio" for stream in probe["streams"])
    receipt = {"output": str(output), "duration_seconds": elapsed,
               "frames": video["nb_frames"], "dimensions": [1280, 768], "chapters": chapters,
               "capture_method": "timestamped live in-app-browser screenshots; original timing",
               "audio": "silent; no audio requested or recorded"}
    (captures / "edit-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    # Inspect the first, middle, and final frame of every chapter, including both sides of cuts.
    frames = []
    for chapter in chapters:
        start = chapter["start_seconds"] * 30
        length = chapter["duration_seconds"] * 30
        frames.extend([start, start + length // 2, start + length - 1])
    selection = "+".join(f"eq(n,{frame})" for frame in frames)
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(output), "-vf",
         f"select='{selection}',scale=480:288,tile=3x7", "-frames:v", "1",
         str(captures / "contact-sheet.png")])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(output), "-vf",
         "select='lt(n,240)*not(mod(n,15))',scale=480:288,tile=4x4", "-frames:v", "1",
         str(captures / "orbit-contact-sheet.png")])
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
