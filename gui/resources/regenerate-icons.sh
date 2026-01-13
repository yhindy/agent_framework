#!/bin/bash
# Regenerates app icons with rounded corners and padding from the source icon.
# Requires: ImageMagick (brew install imagemagick)

set -e
cd "$(dirname "$0")"

SOURCE_ICON="icon_original_backup.png"
INNER_SIZE=820
CANVAS_SIZE=1024
CORNER_RADIUS=144

echo "=== Regenerating App Icons ==="

# Verify dependencies
if ! command -v magick &> /dev/null; then
    echo "Error: ImageMagick not found. Install with: brew install imagemagick"
    exit 1
fi

if [ ! -f "$SOURCE_ICON" ]; then
    echo "Error: $SOURCE_ICON not found"
    exit 1
fi

# Create padded icon with rounded corners (using temp files to preserve color)
echo "Creating icon with rounded corners and padding..."
magick "$SOURCE_ICON" -resize ${INNER_SIZE}x${INNER_SIZE} -alpha set _resized.png
magick -size ${INNER_SIZE}x${INNER_SIZE} xc:none \
    -draw "roundrectangle 0,0,$((INNER_SIZE-1)),$((INNER_SIZE-1)),$CORNER_RADIUS,$CORNER_RADIUS" _mask.png
magick _resized.png _mask.png -compose DstIn -composite _rounded.png
magick -size ${CANVAS_SIZE}x${CANVAS_SIZE} xc:none _rounded.png -gravity center -composite icon.png
rm _resized.png _mask.png _rounded.png

# Generate iconset
echo "Generating iconset..."
rm -rf icon.iconset
mkdir icon.iconset

for size in 16 32 64 128 256 512 1024; do
    magick icon.png -resize ${size}x${size} -filter Lanczos icon.iconset/icon_${size}x${size}.png
done

# Add @2x variants (each @2x is a copy of the next size up)
for base in 16 32 128 256 512; do
    double=$((base * 2))
    cp icon.iconset/icon_${double}x${double}.png icon.iconset/icon_${base}x${base}@2x.png
done

# Generate macOS .icns
echo "Generating .icns..."
iconutil -c icns icon.iconset -o icon.icns

# Generate Windows .ico (needs 48x48 which isn't in standard iconset)
echo "Generating .ico..."
magick icon.png -resize 48x48 -filter Lanczos _icon48.png
magick icon.iconset/icon_16x16.png \
       icon.iconset/icon_32x32.png \
       _icon48.png \
       icon.iconset/icon_64x64.png \
       icon.iconset/icon_128x128.png \
       icon.iconset/icon_256x256.png \
       icon.ico
rm _icon48.png

echo ""
echo "=== Complete ==="
ls -la icon.png icon.icns icon.ico
