# The market's characters, modelled in Blender and exported to web/public/models/characters.glb.
#
#   pip install bpy           (Blender 5.x as a Python module; the Blender app works too:
#   python art/characters.py   blender -b -P art/characters.py)
#
# The export is squeezed with meshopt (about 420 KB -> 160 KB) by kit.export, via
#   npx @gltf-transform/cli@4 meshopt <raw.glb> web/public/models/characters.glb
#
# Every figure is a tree of pivots (empties) the game swings to walk, wave and dance:
#   <kind> > legL, legR, body > armL, armR, head (> antenna / rotor ...)
# Meshes carry one material each, and the material NAME is a paint slot the game fills in
# (paint = the trader's own colour from their address, skin, hair, shirt, ...), so one model
# gives every trader a different look. Faces are drawn by the game so they can blink and talk.
# Blender faces -Y here, which is +Z (towards the camera) in the game.
import math

import bpy

from kit import cyl, export, flatten, limb, pivot, rbox, sphere, torus


# ---------------------------------------------------------------- robot (kind 2)
def robot(x):
    root = pivot("robot", (x, 0, 0))
    for s, side in ((-1, "L"), (1, "R")):
        leg = pivot(f"robot_leg{side}", (x + s * 0.14, 0, 0.36), root)
        limb(f"robot_shin{side}", (x + s * 0.14, 0, 0.36), 0.26, 0.07, 0.075, "metal", leg)
        rbox(f"robot_foot{side}", (0.19, 0.28, 0.12), (x + s * 0.14, -0.03, 0.06), "trim", leg, bevel=0.05)
    body = pivot("robot_body", (x, 0, 0.36), root)
    rbox("robot_torso", (0.6, 0.44, 0.46), (x, 0, 0.6), "paint", body, bevel=0.12)
    rbox("robot_panel", (0.34, 0.05, 0.16), (x, -0.215, 0.68), "cream", body, bevel=0.04)
    for i, c in enumerate(("accent", "trim")):
        sphere(f"robot_btn{i}", 0.035, (x - 0.07 + i * 0.14, -0.245, 0.69), c, body, segs=12, rings=8)
    for s, side in ((-1, "L"), (1, "R")):
        arm = pivot(f"robot_arm{side}", (x + s * 0.35, 0, 0.74), body)
        sphere(f"robot_shoulder{side}", 0.1, (x + s * 0.35, 0, 0.74), "paint", arm, segs=16, rings=10)
        limb(f"robot_upper{side}", (x + s * 0.35, 0, 0.72), 0.3, 0.055, 0.05, "metal", arm)
        # a mitten claw, like the waving arms of the logo robot
        sphere(f"robot_hand{side}", 0.09, (x + s * 0.35, 0, 0.38), "paint", arm, scale=(0.9, 1.0, 1.1), segs=16, rings=10)
    head = pivot("robot_head", (x, 0, 0.84), body)
    cyl("robot_neck", 0.08, 0.08, 0.14, (x, 0, 0.88), "metal", head)
    rbox("robot_shell", (0.86, 0.64, 0.64), (x, 0, 1.24), "shell", head, bevel=0.15, segs=5)
    rbox("robot_screen", (0.64, 0.05, 0.44), (x, -0.31, 1.24), "screen", head, bevel=0.08, segs=4)
    for s, side in ((-1, "L"), (1, "R")):
        o = cyl(f"robot_ear{side}", 0.1, 0.1, 0.08, (x + s * 0.44, 0, 1.24), "accent", head, rot=(0, math.pi / 2, 0), segs=18,
                round_ends=0.025)
        flatten(o)
    ant = pivot("robot_antenna", (x, 0, 1.55), head)
    cyl("robot_stalk", 0.025, 0.02, 0.22, (x, 0, 1.66), "metal", ant, segs=8)
    sphere("robot_bulb", 0.08, (x, 0, 1.8), "accent", ant, segs=16, rings=10)
    # merchant's apron, shown for shopkeepers
    apron = rbox("robot_apron", (0.56, 0.04, 0.2), (x, -0.23, 0.46), "apron", body, bevel=0.03)
    pocket = rbox("robot_apronpocket", (0.2, 0.03, 0.09), (x + 0.1, -0.255, 0.44), "trim", body, bevel=0.02, segs=2)
    pocket.parent = apron
    pocket.matrix_parent_inverse = apron.matrix_world.inverted()
    return root


# ---------------------------------------------------------------- person (kind 1, and kind 3 with a drone)
def person(x):
    root = pivot("person", (x, 0, 0))
    for s, side in ((-1, "L"), (1, "R")):
        leg = pivot(f"person_leg{side}", (x + s * 0.11, 0, 0.36), root)
        limb(f"person_thigh{side}", (x + s * 0.11, 0, 0.38), 0.3, 0.09, 0.08, "pants", leg)
        rbox(f"person_shoe{side}", (0.17, 0.27, 0.12), (x + s * 0.11, -0.04, 0.06), "shoe", leg, bevel=0.055)
    body = pivot("person_body", (x, 0, 0.36), root)
    o = cyl("person_shirt", 0.28, 0.2, 0.46, (x, 0, 0.58), "shirt", body, segs=20, round_ends=0.08)
    rbox("person_belt", (0.5, 0.42, 0.06), (x, 0, 0.38), "pants", body, bevel=0.03)
    o = torus("person_collar", 0.15, 0.04, (x, 0, 0.8), "cream", body)
    rbox("person_bag", (0.36, 0.17, 0.38), (x, 0.26, 0.6), "bag", body, bevel=0.07)
    rbox("person_bagflap", (0.37, 0.05, 0.16), (x, 0.33, 0.73), "trim", body, bevel=0.03)
    for s, side in ((-1, "L"), (1, "R")):
        rbox(f"person_strap{side}", (0.05, 0.42, 0.04), (x + s * 0.12, 0.02, 0.8), "trim", body, bevel=0.015, segs=2,
             rot=(0.0, 0, 0))
        arm = pivot(f"person_arm{side}", (x + s * 0.27, 0, 0.74), body)
        limb(f"person_sleeve{side}", (x + s * 0.27, 0, 0.78), 0.3, 0.075, 0.065, "shirt", arm)
        sphere(f"person_hand{side}", 0.075, (x + s * 0.27, 0, 0.42), "skin", arm, segs=14, rings=10)
    head = pivot("person_head", (x, 0, 0.82), body)
    cyl("person_neck", 0.07, 0.07, 0.1, (x, 0, 0.86), "skin", head)
    sphere("person_face", 0.4, (x, 0, 1.22), "skin", head, scale=(1.0, 0.95, 0.93), segs=28, rings=18)
    for s, side in ((-1, "L"), (1, "R")):
        sphere(f"person_ear{side}", 0.075, (x + s * 0.39, 0.02, 1.2), "skin", head, scale=(0.6, 1, 1), segs=12, rings=8)
    hz = 1.22
    # hair: the game shows one of these per trader
    sphere("hair_short", 0.42, (x, 0, hz + 0.02), "hair", head, scale=(1.0, 0.98, 0.94), segs=28, rings=18,
           cut=((0, 0, 0.06), (0, 0.55, 1)))
    sphere("hair_bob", 0.43, (x, 0, hz), "hair", head, scale=(1.04, 1.0, 0.98), segs=28, rings=18,
           cut=((0, 0, -0.08), (0, 0.9, 1)))
    bob_tip = sphere("hair_bobfringe", 0.2, (x, -0.26, hz + 0.24), "hair", head, scale=(1.5, 0.6, 0.55), segs=16, rings=10)
    bob_tip.parent = bpy.data.objects["hair_bob"]
    bob_tip.matrix_parent_inverse = bpy.data.objects["hair_bob"].matrix_world.inverted()
    spiky = sphere("hair_spiky", 0.42, (x, 0, hz + 0.02), "hair", head, scale=(1.0, 0.98, 0.9), segs=28, rings=18,
                   cut=((0, 0, 0.1), (0, 0.5, 1)))
    for i, (a, tilt) in enumerate(((0, 0), (1.25, 0.5), (-1.25, 0.5), (2.5, 0.55), (-2.5, 0.55), (math.pi, 0.45))):
        dx, dy = math.sin(a) * 0.17 * (1 if tilt else 0), math.cos(a) * 0.17 * (1 if tilt else 0)
        o = cyl(f"hair_spike{i}", 0.12, 0.0, 0.3, (x + dx, dy + 0.02, hz + 0.43 - tilt * 0.08), "hair", spiky,
                rot=(-dy * 3.2, dx * 3.2, 0), segs=10)
        flatten(o)
    bun = sphere("hair_bun", 0.42, (x, 0, hz + 0.02), "hair", head, scale=(1.0, 0.98, 0.94), segs=28, rings=18,
                 cut=((0, 0, 0.02), (0, 0.6, 1)))
    knot = sphere("hair_bunknot", 0.15, (x, 0.18, hz + 0.4), "hair", head, segs=16, rings=10)
    knot.parent = bun
    knot.matrix_parent_inverse = bun.matrix_world.inverted()
    # hats
    cap = sphere("hat_cap", 0.43, (x, 0, hz), "hat", head, scale=(1.02, 1.02, 0.98), segs=28, rings=18,
                 cut=((0, 0, 0.14), (0, 0.15, 1)))
    brim = cyl("hat_capbrim", 0.24, 0.24, 0.035, (x, -0.34, hz + 0.17), "hat", head, segs=20, round_ends=0.012)
    brim.scale = (1.05, 0.75, 1)
    brim.rotation_euler = (-0.18, 0, 0)
    flatten(brim)
    brim.parent = cap
    brim.matrix_parent_inverse = cap.matrix_world.inverted()
    beanie = sphere("hat_beanie", 0.44, (x, 0, hz + 0.02), "hat", head, scale=(1.02, 1.02, 1.02), segs=28, rings=18,
                    cut=((0, 0, 0.1), (0, 0.3, 1)))
    o = torus("hat_beaniecuff", 0.435, 0.065, (x, 0.02, hz + 0.15), "cream", head, rot=(-0.28, 0, 0))
    flatten(o)
    o.parent = beanie
    o.matrix_parent_inverse = beanie.matrix_world.inverted()
    pom = sphere("hat_beaniepom", 0.11, (x, 0.04, hz + 0.53), "cream", head, segs=14, rings=10)
    pom.parent = beanie
    pom.matrix_parent_inverse = beanie.matrix_world.inverted()
    return root


# ---------------------------------------------------------------- hooded, undeclared (kind 0)
def hooded(x):
    root = pivot("hooded", (x, 0, 0))
    for s, side in ((-1, "L"), (1, "R")):
        leg = pivot(f"hooded_leg{side}", (x + s * 0.12, 0, 0.22), root)
        rbox(f"hooded_boot{side}", (0.17, 0.26, 0.14), (x + s * 0.12, -0.05, 0.07), "shoe", leg, bevel=0.06)
    body = pivot("hooded_body", (x, 0, 0.2), root)
    o = cyl("hooded_cloak", 0.46, 0.22, 0.74, (x, 0, 0.5), "cloak", body, segs=24, round_ends=0.06)
    rbox("hooded_sash", (0.5, 0.48, 0.07), (x, 0.0, 0.46), "trim", body, bevel=0.03)
    sphere("hooded_clasp", 0.06, (x, -0.2, 0.84), "accent", body, segs=14, rings=10)
    for s, side in ((-1, "L"), (1, "R")):
        arm = pivot(f"hooded_arm{side}", (x + s * 0.24, 0, 0.76), body)
        limb(f"hooded_sleeve{side}", (x + s * 0.26, 0, 0.8), 0.32, 0.075, 0.1, "cloak", arm)
        sphere(f"hooded_glove{side}", 0.07, (x + s * 0.26, 0, 0.44), "trim", arm, segs=14, rings=10)
    head = pivot("hooded_head", (x, 0, 0.86), body)
    # the hood: a shell with its front cut open, a dark face inside, a soft tip flopping back
    sphere("hooded_hood", 0.44, (x, 0, 1.2), "cloak", head, scale=(1.0, 1.0, 0.96), segs=28, rings=18,
           cut=((0, -0.2, 0), (0, 1, 0.25)))
    sphere("hooded_void", 0.38, (x, 0.02, 1.18), "void", head, scale=(0.95, 0.9, 0.88), segs=24, rings=14)
    torus("hooded_rim", 0.33, 0.055, (x, -0.2, 1.17), "cloak", head, rot=(math.pi / 2 + 0.25, 0, 0))
    tip = cyl("hooded_tip", 0.16, 0.02, 0.42, (x, 0.3, 1.5), "cloak", head, rot=(1.15, 0, 0), segs=14, round_ends=0.01)
    flatten(tip)
    sphere("hooded_tipball", 0.06, (x, 0.5, 1.6), "accent", head, segs=12, rings=8)
    return root


# ---------------------------------------------------------------- the agent's helper drone (kind 3)
def drone(x):
    root = pivot("drone", (x, 0, 0))
    sphere("drone_body", 0.16, (x, 0, 0), "paint", root, scale=(1, 1, 0.9), segs=20, rings=12)
    rbox("drone_visor", (0.2, 0.05, 0.11), (x, -0.135, 0.01), "screen", root, bevel=0.04)
    torus("drone_band", 0.16, 0.025, (x, 0, -0.02), "metal", root)
    cyl("drone_mast", 0.015, 0.015, 0.1, (x, 0, 0.18), "metal", root, segs=8)
    rotor = pivot("drone_rotor", (x, 0, 0.23), root)
    rbox("drone_blade", (0.46, 0.06, 0.02), (x, 0, 0.23), "dark", rotor, bevel=0.009, segs=2)
    for s in (-1, 1):
        sphere(f"drone_foot{s}", 0.03, (x + s * 0.08, 0, -0.15), "metal", root, segs=8, rings=6)
    return root


robot(0)
person(0)
hooded(0)
drone(0)

export("characters")
