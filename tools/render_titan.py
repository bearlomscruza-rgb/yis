"""Preview renderer for the Bolt Titan model (axis-aligned Bedrock cubes, per-face UV).

python3 tools/render_titan.py <texture.png> [<texture.png> ...] -o out.png
Renders each texture from the front-left and the back-right, side by side.
"""
import json, math, sys
import numpy as np
from PIL import Image

GEO = 'SparkMod_V245_Resources/models/entity/bolt_titan.geo.json'


def faces_of(cube):
    (x, y, z), (sx, sy, sz) = cube['origin'], cube['size']
    inf = cube.get('inflate', 0)
    x0, y0, z0, x1, y1, z1 = x - inf, y - inf, z - inf, x + sx + inf, y + sy + inf, z + sz + inf
    # corners in order: top-left, top-right, bottom-left (as seen from outside)
    return {
        'north': ((x1, y1, z0), (x0, y1, z0), (x1, y0, z0), (0, 0, -1)),
        'south': ((x0, y1, z1), (x1, y1, z1), (x0, y0, z1), (0, 0, 1)),
        'east': ((x1, y1, z1), (x1, y1, z0), (x1, y0, z1), (1, 0, 0)),
        'west': ((x0, y1, z0), (x0, y1, z1), (x0, y0, z0), (-1, 0, 0)),
        'up': ((x0, y1, z0), (x1, y1, z0), (x0, y1, z1), (0, 1, 0)),
        'down': ((x0, y0, z1), (x1, y0, z1), (x0, y0, z0), (0, -1, 0)),
    }


SHADE = {'up': 1.0, 'down': .5, 'north': .82, 'south': .82, 'east': .66, 'west': .66}


def render(tex, yaw_deg, pitch_deg=12, W=360, H=440, scale=6.0, emissive_bones=('sparkmod_glowing_eyes',), hide=(), geo=None, pose=None):
    geo = json.load(open(geo or GEO))['minecraft:geometry'][0]
    t = np.asarray(tex.convert('RGBA')).astype(float) / 255
    th, tw = t.shape[:2]
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    cy, sy_, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)

    def proj(p):
        x, y, z = p
        x, z = x * cy - z * sy_, x * sy_ + z * cy          # yaw about Y
        y, z = y * cp - z * sp, y * sp + z * cp             # pitch about X
        return np.array([W / 2 + x * scale, H - 20 - (y * scale)]), z  # z: bigger = closer to viewer? (viewer at -z)

    # optional pose: {bone: ((rx, ry, rz), (px, py, pz))}, Bedrock-style (negative x raises an arm forward)
    pose = pose or {}
    bones = {b['name']: b for b in geo['bones']}

    def rot(r):
        ax, ay, az = [-math.radians(v) for v in r]
        Rx = np.array([[1, 0, 0], [0, math.cos(ax), -math.sin(ax)], [0, math.sin(ax), math.cos(ax)]])
        Ry = np.array([[math.cos(ay), 0, math.sin(ay)], [0, 1, 0], [-math.sin(ay), 0, math.cos(ay)]])
        Rz = np.array([[math.cos(az), -math.sin(az), 0], [math.sin(az), math.cos(az), 0], [0, 0, 1]])
        return Rz @ Ry @ Rx

    def xform(bname, p):
        p = np.array(p, float)
        while bname:
            b = bones[bname]
            r, off = pose.get(bname, ((0, 0, 0), (0, 0, 0)))
            r = tuple(np.add(r, b.get('rotation', (0, 0, 0))))
            pv = np.array(b.get('pivot', [0, 0, 0]), float)
            p = rot(r) @ (p - pv) + pv + np.array(off, float)
            bname = b.get('parent')
        return tuple(p)

    view = None
    img = np.zeros((H, W, 3))
    img[:] = (0.16, 0.17, 0.2)
    zbuf = np.full((H, W), np.inf)
    for bone in geo['bones']:
        if any(bone['name'].startswith(h) for h in hide):
            continue
        emissive = bone['name'] in emissive_bones
        for cube in bone.get('cubes', []):
            uvs = cube['uv']
            for name, (tl, tr, bl, n) in faces_of(cube).items():
                if pose or any('rotation' in bb for bb in bones.values()):
                    o = np.array(xform(bone['name'], (0, 0, 0)))
                    tl, tr, bl = xform(bone['name'], tl), xform(bone['name'], tr), xform(bone['name'], bl)
                    nn = np.array(xform(bone['name'], n)) - o
                    n = tuple(nn / (np.linalg.norm(nn) or 1))
                # back-face cull: viewer looks along +z in view space
                nx, ny, nz = n
                nx2, nz2 = nx * cy - nz * sy_, nx * sy_ + nz * cy
                ny2, nz3 = ny * cp - nz2 * sp, ny * sp + nz2 * cp
                if nz3 >= 0:
                    continue
                f = uvs.get(name) if isinstance(uvs, dict) else None
                if not f:
                    continue
                (u0, v0), (uw, vh) = f['uv'], f['uv_size']
                P0, z0 = proj(tl)
                P1, z1 = proj(tr)
                P2, z2 = proj(bl)
                e1, e2 = P1 - P0, P2 - P0
                det = e1[0] * e2[1] - e1[1] * e2[0]
                if abs(det) < 1e-6:
                    continue
                pts = np.array([P0, P1, P2, P1 + e2])
                xa, ya = np.floor(pts.min(0)).astype(int)
                xb, yb = np.ceil(pts.max(0)).astype(int)
                xa, ya, xb, yb = max(xa, 0), max(ya, 0), min(xb, W - 1), min(yb, H - 1)
                if xa > xb or ya > yb:
                    continue
                gx, gy = np.meshgrid(np.arange(xa, xb + 1) + .5, np.arange(ya, yb + 1) + .5)
                dx, dy = gx - P0[0], gy - P0[1]
                s = (dx * e2[1] - dy * e2[0]) / det
                tt = (e1[0] * dy - e1[1] * dx) / det
                m = (s >= 0) & (s <= 1) & (tt >= 0) & (tt <= 1)
                if not m.any():
                    continue
                depth = z0 + s * (z1 - z0) + tt * (z2 - z0)
                ui = np.clip((u0 + s * uw).astype(int), 0, tw - 1)
                vi = np.clip((v0 + tt * vh).astype(int), 0, th - 1)
                col = t[vi, ui]
                m &= col[..., 3] > .1
                sub = zbuf[ya:yb + 1, xa:xb + 1]
                m &= depth < sub
                if not m.any():
                    continue
                sub[m] = depth[m]
                shade = 1.0 if emissive else SHADE[name]
                img[ya:yb + 1, xa:xb + 1][m] = col[..., :3][m] * shade
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


if __name__ == '__main__':
    args = sys.argv[1:]
    out = args[args.index('-o') + 1]
    texs = [a for a in args if a != '-o' and a != out]
    tiles = []
    # each argument: texture.png[@hidden_bone_prefix,prefix2][#front]  (#front = front view only)
    for arg in texs:
        front = arg.endswith('#front')
        arg = arg.removesuffix('#front')
        p, _, hide = arg.partition('@')
        tex = Image.open(p)
        h = tuple(x for x in hide.split(',') if x)
        tiles += ([] if front else [render(tex, 210, hide=h)]) + [render(tex, 20, hide=h)]
    W, H = tiles[0].size
    sheet = Image.new('RGB', (W * len(tiles), H))
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * W, 0))
    sheet.save(out)
