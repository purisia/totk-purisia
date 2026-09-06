# -*- coding: utf-8 -*-
"""Generate the PWA icons (Sheikah-eye style mark on a dark ground).

    python tools/make_icons.py

Writes icons/icon-192.png, icons/icon-512.png and icons/icon-maskable-512.png.
"""
import math
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
BG = (11, 16, 24, 255)
ACCENT = (70, 213, 232, 255)
ZONAI = (224, 180, 74, 255)
SS = 4  # supersampling factor


def draw_icon(size, pad_ratio):
    """Draw at SS x resolution, then downsample for clean edges."""
    S = size * SS
    img = Image.new("RGBA", (S, S), BG)
    d = ImageDraw.Draw(img)
    c = S / 2
    r = S * (0.5 - pad_ratio)

    # 바깥 고리
    d.ellipse([c - r, c - r, c + r, c + r], outline=ACCENT, width=int(S * 0.035))

    # 시커의 눈: 양끝이 뾰족한 아몬드 (지수 0.75가 끝을 뾰족하게 만든다)
    w, h = r * 0.80, r * 0.46
    steps = 72
    upper = []
    for i in range(steps + 1):
        x = -1 + 2 * i / steps
        upper.append((c + w * x, c - h * (1 - x * x) ** 0.75))
    lower = [(x, 2 * c - y) for x, y in reversed(upper)]
    d.polygon(upper + lower, fill=ACCENT)

    # 동공
    pr = h * 0.62
    d.ellipse([c - pr, c - pr, c + pr, c + pr], fill=BG)
    d.ellipse([c - pr * 0.45, c - pr * 0.45, c + pr * 0.45, c + pr * 0.45], fill=ZONAI)

    # 아래로 흐르는 눈물 자국
    d.polygon([(c - r * 0.11, c + h * 0.55), (c + r * 0.11, c + h * 0.55),
               (c, c + r * 0.92)], fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, pad in [("icon-192.png", 192, 0.10),
                            ("icon-512.png", 512, 0.10),
                            ("icon-maskable-512.png", 512, 0.22)]:
        path = os.path.join(OUT, name)
        draw_icon(size, pad).save(path, "PNG", optimize=True)
        print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()
