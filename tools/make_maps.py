# -*- coding: utf-8 -*-
"""Prepare the map backgrounds for the 지도 탭.

lud99/totk-unexplored 의 romfs/map/*-medium.png 을 받아 (4500x4500, 게임 좌표
-6000..6000 을 그대로 덮는다) 여백을 잘라내고 WebP 로 다시 인코딩한다.
세 계층 모두 같은 영역으로 잘라야 계층을 바꿔도 지도가 흔들리지 않는다.

    curl -LO https://raw.githubusercontent.com/lud99/totk-unexplored/main/romfs/map/surface-medium.png
    curl -LO .../sky-medium.png
    curl -LO .../depths-medium.png
    python tools/make_maps.py <원본이_있는_디렉터리>

좌표 대응은 totk-unexplored 의 Map.cpp 에서 나온다.
  GameToMap(p) = (p.x, -p.z) * 0.125 * 3  → medium 은 1픽셀 = 8/3m, 중심 = 원점
검증: 하이랄 성 감시탑·고론 시티·리토 마을·카카리코·하테노·루렐린·타레이 타운
좌표를 얹어 지도 위 실제 위치와 일치하는 것을 확인했다.
"""
import json
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

# medium(4500px) 은 small(1500px) 의 3배. 확대했을 때 뭉개지지 않도록 medium 을 쓴다.
SCALE = 3
SIZE = 1500 * SCALE
METERS_PER_PX = 8.0 / SCALE   # 원본 1픽셀이 덮는 게임 유닛
HALF = 6000.0                 # 원본이 덮는 범위 (중심이 원점)

# 세 계층의 내용이 들어 있는 영역의 합집합 (여백 잘라내기). small 기준 좌표에
# SCALE 을 곱해 쓴다.
CROP = tuple(v * SCALE for v in (10, 130, 1480, 1360))

LAYERS = [("surface", "surface-medium.png"),
          ("sky", "sky-medium.png"),
          ("depths", "depths-medium.png")]


def main():
    os.makedirs(OUT, exist_ok=True)
    left, top, right, bottom = CROP

    for name, filename in LAYERS:
        src = os.path.join(SRC, filename)
        img = Image.open(src).convert("RGB")
        if img.size != (SIZE, SIZE):
            raise SystemExit("%s: %dx%d 이미지가 아닙니다 (%s)" % (filename, SIZE, SIZE, img.size))
        out = img.crop(CROP)
        path = os.path.join(OUT, "map-%s.webp" % name)
        out.save(path, "WEBP", quality=78, method=6)
        print("wrote %-24s %5.0f KB  %s" %
              (os.path.relpath(path), os.path.getsize(path) / 1024, out.size))

    # 앱이 좌표를 픽셀로 옮길 때 쓰는 기준값
    meta = {
        "width": right - left,
        "height": bottom - top,
        "metersPerPixel": METERS_PER_PX,
        # 잘라낸 이미지의 좌상단이 가리키는 게임 좌표
        "originX": left * METERS_PER_PX - HALF,
        "originY": HALF - top * METERS_PER_PX,
        "source": "lud99/totk-unexplored romfs/map/*-medium.png",
        "layers": {"Surface": "map-surface.webp",
                   "Sky": "map-sky.webp",
                   "Depths": "map-depths.webp"}
    }
    with open(os.path.join(OUT, "map.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("wrote data/map.json", meta["originX"], meta["originY"])


if __name__ == "__main__":
    main()
