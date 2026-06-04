"""
Generate BTI.ico programmatically using Pillow.
Creates a multi-size .ico with amber/black Bloomberg-style branding.
"""

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

import struct
import zlib
import os
from pathlib import Path

OUT = Path(__file__).parent / "BTI.ico"


def make_icon_pillow():
    sizes = [256, 128, 64, 48, 32, 16]
    images = []
    for size in sizes:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 255))
        draw = ImageDraw.Draw(img)

        # Amber border
        border = max(1, size // 16)
        draw.rectangle([border, border, size - border - 1, size - border - 1],
                       outline=(255, 149, 0, 255), width=border)

        # "BTI" text
        fs = max(6, size // 4)
        try:
            font = ImageFont.truetype("consola.ttf", fs)
        except Exception:
            try:
                font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", fs)
            except Exception:
                font = ImageFont.load_default()

        text = "BTI"
        try:
            bb = draw.textbbox((0, 0), text, font=font)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
        except Exception:
            tw, th = fs * 2, fs

        x = (size - tw) // 2
        y = (size - th) // 2
        draw.text((x, y), text, fill=(255, 149, 0, 255), font=font)

        # Small underline
        uy = y + th + max(1, size // 32)
        draw.line([size // 4, uy, 3 * size // 4, uy],
                  fill=(255, 149, 0, 180), width=max(1, size // 32))

        images.append(img)

    images[0].save(str(OUT), format="ICO",
                   sizes=[(s, s) for s in sizes],
                   append_images=images[1:])
    print(f"Icon saved: {OUT}")


def make_minimal_ico():
    """Fallback: create a minimal valid 32x32 .ico without Pillow."""
    # 32x32 RGBA raw pixels — amber B on black background
    size = 32
    pixels = []
    amber = (0xFF, 0x95, 0x00, 0xFF)  # BGRA
    black = (0x00, 0x00, 0x00, 0xFF)
    border_px = 2

    for y in range(size):
        row = []
        for x in range(size):
            on_border = (x < border_px or x >= size - border_px or
                         y < border_px or y >= size - border_px)
            # Draw "B" shape roughly
            mid_x = size // 2
            mid_y = size // 2
            in_b = (8 <= x <= 14 or (
                (10 <= y <= 15 or 15 <= y <= 20) and 14 <= x <= 18 and
                (y < 13 or y > 17)
            ))
            if on_border or in_b:
                row.extend(amber)
            else:
                row.extend(black)
        pixels.extend(row)

    # ICO format header
    # ICONDIR
    ico_header = struct.pack("<HHH", 0, 1, 1)
    # ICONDIRENTRY: width, height, colorCount, reserved, planes, bitCount, bytesInRes, imageOffset
    # BMP header size = 40, pixel data = 32*32*4 = 4096, mask = 32*4 = 128
    bmp_size = 40 + 32 * 32 * 4 + 32 * 4
    icon_dir_entry = struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, bmp_size, 22)
    # BITMAPINFOHEADER
    bi_header = struct.pack("<IiiHHIIiiII", 40, 32, 64, 1, 32, 0, bmp_size - 40, 0, 0, 0, 0)
    # Pixel data (bottom-up)
    pixel_data = bytearray()
    for y in range(size - 1, -1, -1):
        for x in range(size):
            base = (y * size + x) * 4
            r, g, b, a = pixels[base], pixels[base+1], pixels[base+2], pixels[base+3]
            pixel_data.extend([b, g, r, a])
    # AND mask (all zeros = opaque)
    and_mask = bytes(32 * 4)

    with open(str(OUT), "wb") as f:
        f.write(ico_header)
        f.write(icon_dir_entry)
        f.write(bi_header)
        f.write(pixel_data)
        f.write(and_mask)
    print(f"Minimal icon saved: {OUT}")


if __name__ == "__main__":
    if HAS_PILLOW:
        make_icon_pillow()
    else:
        make_minimal_ico()
