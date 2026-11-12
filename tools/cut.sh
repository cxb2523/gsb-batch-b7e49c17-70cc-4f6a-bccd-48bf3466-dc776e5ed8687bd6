#!/bin/sh
# Joins the shots written by tools/record.mjs into one 30 fps H.264 file, hard cuts, in name order.
#   sh tools/cut.sh <framesDir> <out.mp4>
set -e
IN="$1"; OUT="$2"; TMP="$IN/_all"
rm -rf "$TMP"; mkdir -p "$TMP"
n=0
for shot in $(ls "$IN" | grep -v '^_' | sort); do
  for f in $(ls "$IN/$shot" | sort); do
    ln -s "$IN/$shot/$f" "$TMP/$(printf '%05d' $n).jpg"; n=$((n+1))
  done
done
ffmpeg -y -loglevel error -framerate 30 -i "$TMP/%05d.jpg" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart "$OUT"
echo "$OUT: $n frames, $(echo "scale=1; $n/30" | bc) s"
