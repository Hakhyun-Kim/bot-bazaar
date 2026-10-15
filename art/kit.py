# Shared modelling kit for the market's Blender scripts (characters.py, props.py): rounded toy shapes,
# one material per mesh whose NAME is the paint slot the game fills in, pivots as empties, and a
# meshopt-squeezed GLB export. Blender faces -Y, which is +Z (towards the camera) in the game.
import math
import os
import subprocess
import tempfile

import bpy  # first: bmesh and mathutils come with it
import bmesh
from mathutils import Matrix, Vector

MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "models")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATS = {}


def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (0.8, 0.8, 0.8, 1)
        MATS[name] = m
    return MATS[name]


def link(obj, parent):
    scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def pivot(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    link(e, parent)
    bpy.context.view_layer.update()
    return e


def finish(name, bm, slot, parent, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat(slot))
    o = bpy.data.objects.new(name, me)
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    link(o, parent)
    bpy.context.view_layer.update()
    return o


def rbox(name, size, loc, slot, parent, bevel=0.06, segs=4, rot=(0, 0, 0)):
    """A box with rounded edges: the toy look of the robot merchant in the logo."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=min(bevel, min(size) / 2 - 0.001), segments=segs,
                    affect="EDGES", profile=0.5)
    o = finish(name, bm, slot, parent, loc, rot)
    smooth_by_angle(o)
    return o


def smooth_by_angle(o, deg=40):
    """Flat faces stay flat, rounded edges shade smoothly (keeps the outline clean)."""
    me = o.data
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(deg):
            e.smooth = False
    bm.to_mesh(me)
    bm.free()


def sphere(name, r, loc, slot, parent, scale=(1, 1, 1), segs=24, rings=14, cut=None):
    """cut=(point, normal): keep only the part on the normal's side (hair caps, hoods)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    if cut:
        p, n = Vector(cut[0]), Vector(cut[1]).normalized()
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=p, plane_no=n,
                               clear_inner=True)
    return finish(name, bm, slot, parent, loc)


def cyl(name, r1, r2, depth, loc, slot, parent, rot=(0, 0, 0), segs=16, round_ends=0.0):
    """A cylinder or cone along Z, centred on loc; round_ends bevels the rims into a capsule-ish limb."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    if round_ends:
        rims = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(50)]
        bmesh.ops.bevel(bm, geom=rims, offset=round_ends, segments=4, affect="EDGES", profile=0.5)
    o = finish(name, bm, slot, parent, loc, rot)
    smooth_by_angle(o, 50)
    return o


def limb(name, top, length, r_top, r_bottom, slot, parent, segs=14):
    """A limb hanging down from its pivot (top in the parent's space)."""
    return cyl(name, r_bottom, r_top, length, (top[0], top[1], top[2] - length / 2), slot, parent, segs=segs,
               round_ends=min(r_top, r_bottom) * 0.7)


def torus(name, r, tube, loc, slot, parent, rot=(0, 0, 0)):
    bm = bmesh.new()
    segs, sides = 28, 10
    verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ring = []
        for j in range(sides):
            b = 2 * math.pi * j / sides
            ring.append(bm.verts.new(((r + tube * math.cos(b)) * math.cos(a), (r + tube * math.cos(b)) * math.sin(a),
                                      tube * math.sin(b))))
        verts.append(ring)
    for i in range(segs):
        for j in range(sides):
            a, b = verts[i][j], verts[(i + 1) % segs][j]
            c, d = verts[(i + 1) % segs][(j + 1) % sides], verts[i][(j + 1) % sides]
            bm.faces.new((a, b, c, d))
    return finish(name, bm, slot, parent, loc, rot)


def flatten(o):
    """Bake the object's own rotation/scale into its mesh so the exported node is clean."""
    me = o.data
    me.transform(Matrix.LocRotScale(None, o.rotation_euler.to_quaternion(), o.scale))
    o.rotation_euler = (0, 0, 0)
    o.scale = (1, 1, 1)



def export(name):
    """Write web/public/models/<name>.glb, squeezed with meshopt (three's GLTFLoader reads it)."""
    out = os.path.join(MODELS, f"{name}.glb")
    raw = os.path.join(tempfile.gettempdir(), f"{name}.raw.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=raw, export_format="GLB", export_apply=False, export_materials="EXPORT",
                              export_normals=True, export_texcoords=False, export_yup=True, use_selection=False)
    subprocess.run(["npx", "-y", "@gltf-transform/cli@4", "meshopt", raw, out], check=True)
    print("wrote", out, os.path.getsize(out), "bytes")


def blobs(name, parts, slot, parent, loc=(0, 0, 0)):
    """Several spheres as one mesh (a bush, a bunch of blossoms): one draw call for the lot."""
    import bmesh as bm_
    bm = bm_.new()
    for r, (px, py, pz), sc in parts:
        g = bm_.ops.create_uvsphere(bm, u_segments=14, v_segments=9, radius=r)
        vs = g["verts"]
        bm_.ops.scale(bm, vec=Vector(sc), verts=vs)
        bm_.ops.translate(bm, vec=Vector((px, py, pz)), verts=vs)
    return finish(name, bm, slot, parent, loc)


def lathe(name, profile, slot, parent, loc=(0, 0, 0), segs=20):
    """Spin a (radius, height) profile around Z: barrels, pots."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z))
                      for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, slot, parent, loc)
