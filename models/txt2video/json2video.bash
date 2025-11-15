#!/usr/bin/env bash
set -euo pipefail

INPUT_JSON="${1:-latte_response.json}"
OUTPUT_MP4="${2:-latte.mp4}"

# FPS from JSON, fallback to 8 if not present
FPS="$(jq -r '.fps // 8' "$INPUT_JSON")"

# Temp dir for frames
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Using temp dir: $TMP_DIR"
echo "FPS: $FPS"

# Decode base64 frames into PNGs: frame_0000.png, frame_0001.png, ...
i=0
while IFS= read -r b64; do
  printf -v frame_path "%s/frame_%04d.png" "$TMP_DIR" "$i"
  printf '%s' "$b64" | base64 -d > "$frame_path"
  i=$((i+1))
done < <(jq -r '.frames[]' "$INPUT_JSON")

echo "Decoded $i frames"

# Stitch into MP4
ffmpeg -y \
  -framerate "$FPS" \
  -i "$TMP_DIR/frame_%04d.png" \
  -c:v libx264 \
  -pix_fmt yuv420p \
  "$OUTPUT_MP4"

echo "Wrote video to: $OUTPUT_MP4"
