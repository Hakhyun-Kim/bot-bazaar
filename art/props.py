# The market's props, modelled in Blender and exported to web/public/models/props.glb:
# crates, barrels, lamp posts, flower bushes and pot plants. The game draws each one many times
# with instancing (one draw call per part), painted by material name like the characters.
#   python art/props.py        (needs `pip install bpy`; see characters.py)
import math

import bpy

from kit import blobs, cyl, export, lathe, pivot, rbox, torus


def crate():
    root = pivot("crate", (0, 0, 0))
    rbox("crate_box", (0.62, 0.62, 0.56), (0, 0, 0.28), "wood", root, bevel=0.04)
    rbox("crate_band", (0.65, 0.65, 0.07), (0, 0, 0.3), "woodDark", root, bevel=0.025)
    rbox("crate_lid", (0.66, 0.66, 0.06), (0, 0, 0.56), "lid", root, bevel=0.025)
    blobs("crate_goods", [(0.1, (dx, dy, 0.64), (1, 1, 0.9)) for dx, dy in ((-0.14, -0.1), (0.12, -0.08), (0.0, 0.12))], "goods2", root)


def barrel():
    root = pivot("barrel", (0, 0, 0))
    prof = [(0.27 + 0.07 * math.sin(math.pi * k / 8), 0.78 * k / 8) for k in range(9)]
    lathe("barrel_body", prof, "wood", root)
    for z in (0.16, 0.62):
        torus(f"barrel_hoop{z}", 0.33 if z > 0.3 else 0.31, 0.025, (0, 0, z), "metal", root)
    cyl("barrel_lid", 0.27, 0.27, 0.04, (0, 0, 0.79), "woodDark", root, segs=20)
    # apples on top: goods for sale
    blobs("barrel_goods", [(0.08, (dx, dy, 0.86), (1, 1, 1)) for dx, dy in ((-0.08, 0), (0.08, 0.03), (0, -0.09), (0.02, 0.1))],
          "goods", root)


def lamp():
    root = pivot("lamp", (0, 0, 0))
    cyl("lamp_base", 0.18, 0.13, 0.2, (0, 0, 0.1), "woodDark", root, segs=12, round_ends=0.03)
    cyl("lamp_post", 0.06, 0.05, 2.5, (0, 0, 1.35), "woodDark", root, segs=10)
    rbox("lamp_arm", (0.06, 0.55, 0.06), (0, -0.25, 2.55), "woodDark", root, bevel=0.02, segs=2)
    rbox("lamp_glass", (0.24, 0.24, 0.3), (0, -0.48, 2.25), "glow", root, bevel=0.05)
    cyl("lamp_cap", 0.2, 0.05, 0.14, (0, -0.48, 2.46), "roof", root, segs=4, rot=(0, 0, math.pi / 4))
    cyl("lamp_foot", 0.14, 0.14, 0.04, (0, -0.48, 2.08), "roof", root, segs=4, rot=(0, 0, math.pi / 4))


def bush():
    root = pivot("bush", (0, 0, 0))
    blobs("bush_leaves", [(0.42, (0, 0, 0.32), (1, 1, 0.85)), (0.32, (0.36, 0.1, 0.24), (1, 1, 0.85)),
                          (0.3, (-0.34, -0.06, 0.22), (1, 1, 0.85)), (0.26, (0.05, -0.3, 0.2), (1, 1, 0.85))], "leaf", root)
    pts = [(0.0, -0.32, 0.5), (0.3, -0.2, 0.42), (-0.28, -0.3, 0.36), (0.15, 0.2, 0.62), (-0.18, 0.05, 0.64),
           (0.48, 0.0, 0.36), (-0.5, 0.05, 0.3), (0.1, -0.5, 0.25)]
    blobs("bush_flowers", [(0.075, p, (1, 1, 0.8)) for p in pts], "flower", root)


def pot():
    root = pivot("pot", (0, 0, 0))
    lathe("pot_body", [(0.2, 0), (0.26, 0.3), (0.3, 0.36), (0.3, 0.42), (0.25, 0.42)], "pot", root)
    blobs("pot_plant", [(0.26, (0, 0, 0.62), (1, 1, 1.15)), (0.18, (0.16, 0.06, 0.82), (1, 1, 1.1)),
                        (0.16, (-0.14, -0.04, 0.86), (1, 1, 1.1))], "leaf", root)


crate()
barrel()
lamp()
bush()
pot()
export("props")
