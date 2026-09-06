# -*- coding: utf-8 -*-
"""Build data/bosses.json and data/waypoints.json for the TotK boss tracker.

Sources (open data, fetched from GitHub -- see tools/README.md):
  * lud99/totk-unexplored   romfs/map_data.json          -> shrines, hinoxes, taluses
  * vetyst/TotK-Object-Map  data/v1.2.0/layers/*.json    -> lynels, boss variants, layer
  * vetyst/TotK-Object-Map  data/v1.2.0/locations.json   -> Skyview Towers, region names

Coordinate conventions (derived by cross-referencing the two dumps):
  map_data.json : engine coords with y = height and a +105.5 marker offset,
                  so in-game (X, Y, Z) = (x, -z, y - 105.5)
  vetyst dumps  : (x, y, z) = (in-game Y, in-game X, in-game Z)
"""
import json
import math
import os
import sys
from collections import Counter

Z_OFFSET = 105.5
SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as fh:
        return json.load(fh)


md = load("map_data.json")
loc = load("locations.json")
LAYER_FILES = [("surface.json", "Surface", False),
               ("depths.json", "Depths", False),
               ("sky.json", "Sky", False),
               ("cave.json", "Surface", True)]
layers = [(lay, cave, load(f)) for f, lay, cave in LAYER_FILES]


def md_ig(p):
    return (round(p["x"], 1), round(-p["z"], 1), round(p["y"] - Z_OFFSET, 1))


def vt_ig(l):
    return (round(l["y"], 1), round(l["x"], 1), round(l["z"], 1))


# --------------------------------------------------------------- regions ---
# map_data.json's "locations" are the in-game named places (plains, lakes,
# towns, depths mines) -- the right granularity for a region label. Caves,
# wells and chasms live in separate tables and are deliberately left out.
# A handful of entries in that table are repeated utility markers rather
# than places, and they would drown out the real region name.
NOT_A_REGION = {"Bargainer Statue", "Crystal Refinery", "Forge Construct",
                "Dragon's Tear", "Great Fairy Fountain", "Device Dispenser"}
regions = [(e["display_name"], md_ig(e["position"])) for e in md["locations"]
           if e["display_name"] not in NOT_A_REGION]


def region_of(P):
    """Nearest in-game named location, in 3D."""
    best, bd = "Hyrule", 1e18
    for n, C in regions:
        d = math.dist(P, C)
        if d < bd:
            bd, best = d, n
    return best


# ----------------------------------------------------- placement dump index ---
def collect(prefixes):
    out = []
    for lay, cave, d in layers:
        for k, v in d.items():
            actor = k.split(" : ")[0]
            if any(actor.startswith(p) for p in prefixes):
                for l in v["locations"]:
                    out.append({"layer": lay, "cave": cave, "actor": actor, "p": vt_ig(l)})
    return out


giants = collect(["Enemy_Giant"])
golems = collect(["Enemy_Golem_Junior", "Enemy_Golem_Middle", "Enemy_Golem_Senior",
                  "Enemy_Golem_Fire", "Enemy_Golem_Ice", "Enemy_Golem_Fort"])
lynels = collect(["Enemy_Lynel"])

ACTOR_NAME = {
    "Enemy_Giant_Junior": ("Hinox", "히녹스"),
    "Enemy_Giant_Middle": ("Blue Hinox", "푸른 히녹스"),
    "Enemy_Giant_Senior": ("Black Hinox", "검은 히녹스"),
    "Enemy_Giant_Bone": ("Stalnox", "본 히녹스"),
    "Enemy_Giant_Bone_AllDay": ("Stalnox", "본 히녹스"),
    "Enemy_Golem_Junior": ("Stone Talus", "바위록"),
    "Enemy_Golem_Junior_KeyCrystal": ("Stone Talus", "바위록"),
    "Enemy_Golem_Middle": ("Luminous Talus", "광물 바위록"),
    "Enemy_Golem_Senior": ("Rare Talus", "희귀 바위록"),
    "Enemy_Golem_Fire": ("Igneo Talus", "용암 바위록"),
    "Enemy_Golem_Fire_KeyCrystal": ("Igneo Talus", "용암 바위록"),
    "Enemy_Golem_Ice": ("Frost Talus", "얼음 바위록"),
    "Enemy_Golem_Ice_KeyCrystal": ("Frost Talus", "얼음 바위록"),
    "Enemy_Golem_Fort_A": ("Battle Talus", "요새 바위록"),
    "Enemy_Golem_Fort_A_Wander": ("Battle Talus", "요새 바위록"),
    "Enemy_Lynel_Junior": ("Lynel", "라이넬"),
    "Enemy_Lynel_Middle": ("Blue-Maned Lynel", "푸른 갈기 라이넬"),
    "Enemy_Lynel_Senior": ("White-Maned Lynel", "흰 갈기 라이넬"),
    "Enemy_Lynel_Dark": ("Silver Lynel", "은 갈기 라이넬"),
    "Enemy_Lynel_Boss": ("Lynel (Colosseum)", "라이넬 (투기장)"),
    "Enemy_Lynel_Boss_Middle": ("Blue-Maned Lynel (Colosseum)",
                                "푸른 갈기 라이넬 (투기장)"),
    "Enemy_Lynel_Boss_Senior": ("White-Maned Lynel (Colosseum)",
                                "흰 갈기 라이넬 (투기장)"),
    "Enemy_Lynel_Boss_Dark": ("Silver Lynel (Colosseum)",
                              "은 갈기 라이넬 (투기장)"),
}
TYPE_KO = {"Lynel": "라이넬", "Hinox": "히녹스", "Talus": "바위록"}


def nearest_actor(P, cand, tol=60.0):
    """Nearest placement in the object dump (3D -- surface and depths bosses
    can share the same map pixel, so height has to be part of the match)."""
    best, bd = None, 1e18
    for c in cand:
        d = math.dist(P, c["p"])
        if d < bd:
            bd, best = d, c
    return best if bd <= tol else None


def layer_of(P):
    return "Depths" if P[2] < -200 else "Surface"


bosses = []


def add_boss(btype, actor, P, layer, cave=False):
    en, ko = ACTOR_NAME.get(actor, (btype, TYPE_KO[btype]))
    bosses.append({
        "type": btype,
        "name": en,
        "nameKo": ko,
        "variant": actor,
        "region": region_of(P),
        "layer": layer or layer_of(P),
        "cave": cave,
        "coords": list(P),
    })


for key, btype, cand, fallback in [("hinoxes", "Hinox", giants, "Enemy_Giant_Junior"),
                                   ("taluses", "Talus", golems, "Enemy_Golem_Junior")]:
    missing = 0
    for e in md[key]:
        P = md_ig(e["position"])
        c = nearest_actor(P, cand)
        if c is None:
            missing += 1
            add_boss(btype, fallback, P, None)
        else:
            add_boss(btype, c["actor"], P, c["layer"], c["cave"])
    print(btype, len(md[key]), "placements, variant not resolved for", missing)

# map_data.json carries no lynel table, so lynels come straight from the
# placement dump; near-identical placements (difficulty variants of the same
# encounter) are collapsed.
seen = []
for c in sorted(lynels, key=lambda c: c["actor"]):
    if any(math.dist(c["p"], s) < 30 for s in seen):
        continue
    seen.append(c["p"])
    add_boss("Lynel", c["actor"], c["p"], c["layer"], c["cave"])
print("Lynel", sum(1 for b in bosses if b["type"] == "Lynel"), "of", len(lynels), "placements")

bosses.sort(key=lambda b: (b["type"], b["layer"], b["region"], b["coords"]))
seq = Counter()
for b in bosses:
    seq[b["type"]] += 1
    b["id"] = "%s-%03d" % (b["type"].lower(), seq[b["type"]])
bosses = [{"id": b["id"], "type": b["type"], "name": b["name"], "nameKo": b["nameKo"],
           "variant": b["variant"], "region": b["region"], "layer": b["layer"],
           "cave": b["cave"], "coords": b["coords"]} for b in bosses]

# ------------------------------------------------------------- waypoints ---
# Every one of the 120 surface shrines has a Lightroot mirrored directly
# beneath it in the Depths; the 32 shrines left over are the sky shrines.
# Matching is done one-to-one, because a sky shrine can float above a
# lightroot that already belongs to the surface shrine below it.
shrine_pts = [md_ig(s["position"]) for s in md["shrines"]]
root_pts = [md_ig(e["position"]) for e in md["lightroots"]]
pairs = sorted((math.hypot(P[0] - q[0], P[1] - q[1]), i, j)
               for i, P in enumerate(shrine_pts)
               for j, q in enumerate(root_pts)
               if math.hypot(P[0] - q[0], P[1] - q[1]) < 80)
mirrored, taken = set(), set()
for _, i, j in pairs:
    if i not in mirrored and j not in taken:
        mirrored.add(i)
        taken.add(j)

waypoints = []
for i, s in enumerate(md["shrines"]):
    P = shrine_pts[i]
    waypoints.append({
        "id": "shrine-%03d" % (i + 1),
        "type": "Shrine",
        "name": s["display_name"],
        "internalName": s["internal_name"],
        "region": region_of(P),
        "layer": "Surface" if i in mirrored else "Sky",
        "coords": list(P),
    })

towers = []
for entries in loc.values():
    for e in entries:
        if e["type"] == "LocationArea" and "Skyview Tower" in e["name"]:
            towers.append((e["raw"], e["name"], vt_ig(e["locations"][0])))
towers.sort()
for i, (raw, name, P) in enumerate(towers, 1):
    waypoints.append({
        "id": "tower-%02d" % i,
        "type": "Tower",
        "name": name,
        "internalName": raw,
        "region": region_of(P),
        "layer": "Surface",
        "coords": list(P),
    })

os.makedirs(OUT, exist_ok=True)
for name, payload in [("bosses.json", bosses), ("waypoints.json", waypoints)]:
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

print("bosses", len(bosses), dict(Counter(b["type"] for b in bosses)),
      dict(Counter(b["layer"] for b in bosses)))
print("waypoints", len(waypoints), dict(Counter(w["type"] for w in waypoints)),
      dict(Counter(w["layer"] for w in waypoints)))
