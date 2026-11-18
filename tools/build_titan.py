"""Builds the Bolt Titan models and skins (V224).

python3 tools/build_titan.py

Two models:
  * classic  - the original Bolt Titan (horns, robe, skulls, rocks, chest core), read from
               tools/titan_classic.geo.json, used for phases 1-3.
  * god      - the Spark God statue (halo, crest, ribbons, big glowing chest, sword and spear),
               used while god mode is active.
Each face gets its own rectangle in the texture and every texel is painted from its real 3D
position on the body, so patterns run smoothly and continuously across the whole model.

Writes into SparkMod_V224_Resources:
  models/entity/bolt_titan.geo.json, models/entity/bolt_titan_god.geo.json
  textures/entity/bolt_titan.png (phase 1), bolt_titan_low1/low2/low.png (phase 2 crack stages),
  bolt_titan_p3_1/_2/_3.png (phase 3: yellow, black fragments), bolt_titan_god.png
and SparkMod_V224_Behavior/scripts/titan_model.js (anchor points used by the effects).
"""
import json, math
import numpy as np
from PIL import Image

RP = 'SparkMod_V224_Resources/'
BP = 'SparkMod_V224_Behavior/'


def C(o, s, mat, **kw):
    return dict(origin=list(o), size=list(s), mat=mat, **kw)


def mirror(c):
    o, s = c['origin'], c['size']
    m = dict(c)
    m['origin'] = [-(o[0] + s[0]), o[1], o[2]]
    m['mirrored'] = not c.get('mirrored', False)
    return m


# ============================================================================ classic model
PATCH_MAT = {(0, 0): 'skin', (32, 0): 'skin_dark', (64, 0): 'robe', (192, 0): 'robe', (96, 0): 'leather',
             (128, 0): 'skull', (224, 0): 'gold', (0, 64): 'mossy', (32, 64): 'robe', (128, 64): 'plate',
             (160, 64): 'leather', (224, 96): 'gold', (240, 96): 'core', (224, 80): 'eye', (240, 80): 'eye'}
DENSITY = {'skull': 4, 'eye': 5, 'core': 4, 'plate': 2}


def load_classic():
    g = json.load(open('tools/titan_classic.geo.json'))['minecraft:geometry'][0]
    bones = []
    for b in g['bones']:
        cubes = []
        for c in b.get('cubes', []):
            f = c['uv']['north'] if 'north' in c['uv'] else next(iter(c['uv'].values()))
            mat = PATCH_MAT[tuple(f['uv'])]
            if b['name'].startswith('rocks_'):
                mat = 'rock'
            kw = {}
            if c.get('inflate'):
                kw['inflate'] = c['inflate']
            if mat in DENSITY:
                kw['density'] = DENSITY[mat]
            if f['uv_size'][0] < 0:
                kw['mirrored'] = True
            cubes.append(C(c['origin'], c['size'], mat, **kw))
        bones.append((b['name'], b.get('parent'), tuple(b['pivot']), cubes))
    return bones


CLASSIC = dict(name='classic', bones=load_classic(), tex=(256, 256), chest=np.array([2.7, 42, -8.6]),
               geo_id='geometry.sparkmod.bolt_titan', file='bolt_titan.geo.json')

# ============================================================================ god statue model
# Front is -z. Built like a voxel statue: a tapered robe-like base, broad armoured chest with a
# big round glowing core, helmet with a crest, a large halo, ribbon arcs rising from the shoulders,
# banded arms holding a curved sword and a long spear.
def ring(cx, cy, z, r, n, size, mat, a0=0, a1=2 * math.pi):
    out = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / (n - 1 if a1 - a0 < 2 * math.pi - 1e-6 else n)
        out.append(C((cx + math.cos(a) * r - size / 2, cy + math.sin(a) * r - size / 2, z), (size, size, 1.4), mat))
    return out


SKIRT = [C((-w / 2, y, -d / 2), (w, 4.2, d), 'armor') for y, w, d in
         ((0, 7, 7), (4, 9, 8), (8, 11, 9), (12, 13, 10), (16, 15, 11), (20, 16, 11))]
TORSO = (SKIRT + [C((-7.5, 24, -5.5), (15, 6, 11), 'armor'),           # waist
                  C((-10, 30, -6.5), (20, 6, 13), 'armor'),           # lower chest
                  C((-12.5, 36, -7), (25, 12, 14), 'armor'),          # chest
                  C((-20, 42, -7.5), (8.5, 8, 15), 'armor'), C((11.5, 42, -7.5), (8.5, 8, 15), 'armor'),  # pauldrons
                  C((-4, 48, -4), (8, 3, 8), 'armor')]                # neck
         + ring(0, 50, 7.4, 15, 14, 2.4, 'ribbon', math.radians(-15), math.radians(195)))  # shoulder ribbons
GOD_HEAD = [C((-6.5, 51, -6.5), (13, 12, 13), 'armor'), C((-7, 55.5, -7.1), (14, 1.6, 1), 'armor'),
            C((-1, 63, -1), (2, 8, 2), 'crest'), C((-3.2, 67, -1), (6.4, 1.8, 2), 'crest')]
GOD_EYES = [C((-5, 57.6, -7.2), (3.6, 1.6, .6), 'eye', density=5)]
GOD_HALO = ring(0, 59, 9, 21, 34, 2.8, 'halo')
G_ARM = [C((-22, 26, -4.5), (9, 20, 9), 'armor'), C((-21.5, 10, -4), (8, 16, 8), 'armor'),
         C((-22, 4, -4.5), (9, 6, 9), 'armor')] + [C((-22, y, -4.5), (9, 1.6, 9), 'band', inflate=.45) for y in (14, 20, 30, 37)]
SWORD = ([C((-20.3, 4.6, -7.4), (5.4, 1.6, 2.4), 'crest'), C((-18.5, 5.2, -10), (1.8, 1.6, 3), 'crest')]
         + [C((-18.2, 5.2 + (i / 19) ** 1.7 * 16, -12 - i * 2.4), (1.2, 3.4 - max(0, i - 16) * .8, 2.6), 'blade')
            for i in range(20)])
SPEAR = ([C((17.5 + .38 * (y - 7) - 1.1, y, -6.6 - .08 * (y - 7)), (2.2, 2.2, 2.2), 'staff')
          for y in [-12 + k * 2 for k in range(44)]]
         + [C((17.5 + .38 * (y - 7) - w / 2, y, -6.9 - .08 * (y - 7)), (w, 2.2, 2.8), 'blade')
            for y, w in ((76, 5), (78, 4.2), (80, 3.2), (82, 2.2), (84, 1.2))])
GOD = dict(name='god', tex=(256, 256), chest=np.array([0, 42, -8.8]),
           geo_id='geometry.sparkmod.bolt_titan_god', file='bolt_titan_god.geo.json', bones=[
    ('root', None, (0, 0, 0), []),
    ('body', 'root', (0, 24, 0), TORSO),
    ('heart', 'body', (0, 42, -8.6), [C((-7, 35.5, -9.2), (14, 13, 1.6), 'disc', density=2)]),
    ('head', 'body', (0, 51, 0), GOD_HEAD),
    ('god_halo', 'head', (0, 59, 9), GOD_HALO),
    ('sparkmod_glowing_eyes', 'head', (0, 51, 0), GOD_EYES + [mirror(c) for c in GOD_EYES]),
    ('right_arm', 'body', (-17, 45, 0), G_ARM + SWORD),
    ('left_arm', 'body', (17, 45, 0), [mirror(c) for c in G_ARM] + SPEAR),
    ('right_leg', 'root', (-4, 24, 0), []),
    ('left_leg', 'root', (4, 24, 0), []),
])


def faces(c):
    (x, y, z), (sx, sy, sz) = c['origin'], c['size']
    i = c.get('inflate', 0)
    x0, y0, z0, x1, y1, z1 = x - i, y - i, z - i, x + sx + i, y + sy + i, z + sz + i
    f = {  # tl, tr, bl  (same convention as tools/render_titan.py)
        'north': ((x1, y1, z0), (x0, y1, z0), (x1, y0, z0), (0, 0, -1)),
        'south': ((x0, y1, z1), (x1, y1, z1), (x0, y0, z1), (0, 0, 1)),
        'east': ((x1, y1, z1), (x1, y1, z0), (x1, y0, z1), (1, 0, 0)),
        'west': ((x0, y1, z0), (x0, y1, z1), (x0, y0, z0), (-1, 0, 0)),
        'up': ((x0, y1, z0), (x1, y1, z0), (x0, y1, z1), (0, 1, 0)),
        'down': ((x0, y0, z1), (x1, y0, z1), (x0, y0, z0), (0, -1, 0)),
    }
    out = {}
    for k, (tl, tr, bl, n) in f.items():
        w = math.dist(tl, tr)
        h = math.dist(tl, bl)
        if w < 1e-6 or h < 1e-6:
            continue
        out[k] = (np.array(tl), np.array(tr), np.array(bl), np.array(n), w, h)
    return out


def build_atlas(model):
    W, H = model['tex']
    rects = []
    for bname, _, _, cubes in model['bones']:
        for ci, c in enumerate(cubes):
            d = c.get('density', 1)
            for fname, (_, _, _, _, w, h) in faces(c).items():
                rects.append([bname, ci, fname, max(1, math.ceil(w * d - 1e-6)), max(1, math.ceil(h * d - 1e-6))])
    rects.sort(key=lambda r: -r[4])
    x = y = shelf = 0
    place = {}
    for bname, ci, fname, tw, th in rects:
        if x + tw > W:
            x, y, shelf = 0, y + shelf, 0
        place[(bname, ci, fname)] = (x, y, tw, th)
        x += tw
        shelf = max(shelf, th)
    assert y + shelf <= H, f"{model['name']} atlas overflow {y + shelf}"
    model['place'] = place


def write_geo(model):
    bones = []
    for bname, parent, pivot, cubes in model['bones']:
        b = {'name': bname, 'pivot': [round(v, 3) for v in pivot]}
        if parent:
            b['parent'] = parent
        out = []
        for ci, c in enumerate(cubes):
            uv = {}
            for fname in faces(c):
                x, y, tw, th = model['place'][(bname, ci, fname)]
                uv[fname] = {'uv': [x, y], 'uv_size': [tw, th]}
            cube = {'origin': [round(v, 3) for v in c['origin']], 'size': [round(v, 3) for v in c['size']], 'uv': uv}
            if c.get('inflate'):
                cube['inflate'] = c['inflate']
            out.append(cube)
        if out:
            b['cubes'] = out
        bones.append(b)
    W, H = model['tex']
    geo = {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': model['geo_id'], 'texture_width': W, 'texture_height': H,
                        'visible_bounds_width': 7, 'visible_bounds_height': 7, 'visible_bounds_offset': [0, 3, 0]},
        'bones': bones}]}
    json.dump(geo, open(RP + 'models/entity/' + model['file'], 'w'), indent=1)


# ----------------------------------------------------------------------------- 3D noise
def _hash(xi, yi, zi, seed):
    h = (xi * 73856093) ^ (yi * 19349663) ^ (zi * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def vnoise(P, freq, seed=0):
    Q = P * freq
    i = np.floor(Q).astype(np.int64)
    f = Q - i
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out


def fbm(P, freq, seed, octaves=3):
    v, a, t = 0, 1, 0
    for o in range(octaves):
        v = v + a * vnoise(P, freq * 2 ** o, seed + o * 17)
        t += a
        a *= .5
    return v / t


def ridge(P, freq, seed, width):
    """1 on thin worm-like lines through 3D space (cracks / veins), 0 elsewhere; soft edge."""
    n = vnoise(P, freq, seed) * .8 + vnoise(P, freq * 2.3, seed + 5) * .2
    d = np.abs(n - .5)
    return np.clip(1 - d / width, 0, 1)


def hexramp(*hs):
    return np.array([[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)] for h in hs])


def ramp(v, r):
    return r[np.clip((v * len(r)).astype(int), 0, len(r) - 1)]


STONE = hexramp('#3a3940', '#4b494f', '#5d5a5f', '#716c6f', '#857f80', '#9a938f', '#ada59e')
STONE_D = hexramp('#232228', '#2e2c33', '#3a373f', '#47434b', '#55515a')
MOSS = hexramp('#2c461a', '#3b5d22', '#4c762a', '#609233', '#77ab3e')
ROBE = hexramp('#24140c', '#311c10', '#422615', '#55311b', '#6a3e22', '#7e4b29')
GOLD = hexramp('#6b4a0e', '#946a12', '#bf8e17', '#e2b425', '#f7d750', '#fff08f')
BONE = hexramp('#5d564a', '#81796a', '#a59d8b', '#c9c1ad', '#e6dfcb')
AMBER = hexramp('#5a3c05', '#7d5508', '#a2700e', '#c78f17', '#e6ae23', '#f7c93a', '#ffe46a')
AMBER_D = hexramp('#3a2604', '#523606', '#6d4909', '#8a5e0e', '#a87515', '#c48c1e')
OCHRE = hexramp('#3b2306', '#523109', '#6b410c', '#845210', '#9c6315', '#b4761b')
YEL = hexramp('#c99a12', '#dcaf1c', '#ecc22a', '#f7d43e', '#fde35a', '#fff07f', '#fff8b0')
YEL_D = hexramp('#a37a0c', '#b98c12', '#cc9e18', '#ddb021', '#ebc02d')
ASH = hexramp('#08070a', '#121014', '#1c191e', '#26222a')
VOID = hexramp('#050407', '#0a090d', '#100e14', '#16141b', '#1d1a23')
HOT = np.array([1, 1, .88])
MID = np.array([1, .86, .22])
CHEST = np.array([0, 35, -8.5])


def glow_mix(col, g, color=MID, core=HOT, halo=.6):
    g = g[..., None]
    col = col * (1 - g * halo) + color * g * halo
    return np.where(g > .82, core, np.where(g > .55, color, col))


# ----------------------------------------------------------------------------- materials
def paint_face(mat, P, N, s, t, variant, stage, cube, fname):
    """P: (h,w,3) model-space positions; N: normal; s,t: face-local 0..1 coords."""
    h, w = P.shape[:2]
    n1 = fbm(P, .16, 1)
    n2 = fbm(P, .45, 2, 2)
    up = N[1]
    shade = .12 * (P[..., 1] / 64)  # a little lighter toward the top
    edge = np.minimum.reduce([s, 1 - s, t, 1 - t])
    rim = np.clip(1 - edge * min(w, h) / 1.6, 0, 1) * .16
    dist_chest = np.linalg.norm(P - CHEST, axis=-1)
    phase1 = variant == 'p1'
    p2 = variant == 'p2'
    p3 = variant == 'p3'
    god = variant == 'god'

    def stone(r, base=.25):
        v = base + n1 * .5 + n2 * .18 + shade - rim
        # carved slab seams in world space (horizontal courses, staggered joints)
        course = np.floor(P[..., 1] / 7.0)
        sy = (P[..., 1] % 7.0) < .9
        jx = ((P[..., 0] + P[..., 2] + course * 5.3) % 11.0) < .9
        seam = (sy | (jx & (abs(up) < .5))) & (abs(up) < .5)
        col = ramp(np.clip(v, 0, .999), r)
        col[seam] = r[0]
        return col, seam

    if god:
        return paint_god(mat, P, N, s, t, w, h, n1, n2, rim, dist_chest, cube, fname)
    if mat in ('halo', 'crest', 'blade', 'staff', 'disc', 'ribbon', 'band', 'armor'):
        return np.zeros((h, w, 3)) + GOLD[2], None
    mossy = mat == 'mossy'
    if mossy:
        mat = 'skin'
    if mat == 'leather':
        r = {'p1': hexramp('#22160f', '#311f14', '#43291a', '#563521'), 'p2': AMBER_D, 'p3': YEL_D}[variant]
        col = ramp(np.clip(.3 + n2 * .45 - rim, 0, .999), r)
        stud = (np.abs(s - .5) > .32) & ((t * 5) % 1 < .3)
        col[stud] = (GOLD if variant == 'p1' else YEL)[4]
        mat = '_done'
    elif mat == 'plate':
        r = {'p1': hexramp('#3e4046', '#5a5d64', '#7a7d84', '#9da0a6', '#c2c4c8'), 'p2': AMBER, 'p3': YEL}[variant]
        col = ramp(np.clip(.35 + (1 - (s + t) / 2) * .35 + n2 * .15 - rim * 1.5, 0, .999), r)
        if fname == 'north':  # engraved lightning sigil
            pts = [(.62, .08), (.3, .52), (.55, .52), (.36, .92), (.74, .4), (.5, .4)]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                for k in np.linspace(0, 1, 40):
                    xi = int((x0 + (x1 - x0) * k) * (w * 2 - 1e-6))
                    yi = int((y0 + (y1 - y0) * k) * (h * 2 - 1e-6))
                    if 0 <= yi < col.shape[0] and 0 <= xi < col.shape[1]:
                        col[yi, xi] = (GOLD if variant == 'p1' else hexramp('#fff6c0'))[min(4, len(GOLD) - 2) if variant == 'p1' else 0]
        mat = '_done'
    if mat == '_done':
        pass
    elif mat in ('skin', 'skin_dark', 'rock', 'tendril'):
        if god:
            col = ramp(np.clip(.2 + n1 * .5 + n2 * .2 - rim, 0, .999), VOID)
        elif p3:
            r = YEL if mat in ('skin', 'tendril') else YEL_D
            col = ramp(np.clip(.25 + n1 * .5 + n2 * .15 + shade - rim, 0, .999), r)
        else:
            r = {'skin': STONE, 'skin_dark': STONE_D, 'rock': STONE_D, 'tendril': STONE}[mat]
            if p2:
                r = {'skin': AMBER, 'skin_dark': AMBER_D, 'rock': AMBER_D, 'tendril': AMBER}[mat]
            col, seam = stone(r)
            if mat == 'tendril':  # vein lines on the tendril plates
                v = ridge(P, .25, 9, .07)
                col = np.where(v[..., None] > .5, r[0], col)
            if phase1:
                m = fbm(P, .22, 5) + np.clip(up, 0, 1) * .35 + np.clip((14 - P[..., 1]) / 30, 0, .4)
                if mat == 'rock' or mossy:
                    m = m + (.35 if mossy else .2)
                mask = m > .78
                col[mask] = ramp(np.clip(fbm(P, .6, 6) * 1.3 - .15, 0, .999), MOSS)[mask]
            if p2:
                col[seam] = np.where(dist_chest[seam, None] < {1: 0, 2: 22, 3: 99}[stage], MID * .95, col[seam])
    elif mat == 'robe':
        fold = np.sin((P[..., 0] * .55 + P[..., 2] * .55) + np.sin(P[..., 1] * .18) * .8) * .5 + .5
        v = .22 + fold * .3 + n2 * .25 - rim
        r = {'p1': ROBE, 'p2': OCHRE, 'p3': YEL_D, 'god': VOID}[variant]
        col = ramp(np.clip(v, 0, .999), r)
        if fname not in ('up', 'down') and not god and h >= 10:
            band = (t < 2.2 / max(h, 1)) | (t > 1 - 2.2 / max(h, 1))
            tr = GOLD if variant == 'p1' else YEL
            col[band] = ramp(np.clip(.45 + n2[band] * .5, 0, .999), tr)
    elif mat == 'gold':
        r = {'p1': GOLD, 'p2': GOLD, 'p3': YEL, 'god': hexramp('#2a2208', '#3d300b', '#57430f')}[variant]
        v = .35 + n2 * .45 + (1 - t) * .2 - rim
        col = ramp(np.clip(v, 0, .999), r)
    elif mat == 'skull':
        r = BONE if variant in ('p1', 'p2') else (YEL if p3 else VOID)
        col = ramp(np.clip(.45 + n2 * .35 - rim * 1.5, 0, .999), r)
        if fname == 'north':
            dark = np.array([.08, .06, .05]) if not god else np.array([1, .85, .2])
            for cx in (.3, .7):
                m = ((s - cx) / .17) ** 2 + ((t - .4) / .17) ** 2 < 1
                col[m] = dark
            col[(np.abs(s - .5) < .07) & (t > .55) & (t < .68)] = dark
            teeth = (t > .78) & (t < .9) & (np.floor(s * 6) % 2 == 0)
            col[teeth] = dark
    elif mat == 'mouth':
        col = np.zeros((h, w, 3)) + (np.array([.05, .04, .04]) if not (p3 or god) else np.array([.25, .15, .02]))
        if god:
            col = np.zeros((h, w, 3)) + MID
        col[(np.floor(s * 10) % 2 == 0) & ((t < .3) | (t > .7))] = BONE[3] if not god else HOT
    elif mat == 'eye':
        col = np.zeros((h, w, 3)) + np.array([.08, .05, .02])
        if fname == 'north':
            ss = 1 - s if cube.get('mirrored') else s
            top = .1 + ss * .45                      # angry slant: high outside, low toward the nose
            almond = (t > top) & (t < .92 - np.abs(ss - .5) * .3)
            col[almond] = [1, .72, .08]
            col[almond & (t > top + .15)] = [1, .9, .3]
            col[almond & (np.abs(ss - .55) < .09)] = [1, 1, .85]
    elif mat == 'core':
        r = np.hypot(s - .5, t - .5)
        col = np.zeros((h, w, 3)) + np.array([.55, .32, .03])
        for rad, c in ((.46, [.95, .62, .07]), (.34, [1, .85, .2]), (.22, [1, .97, .6]), (.12, [1, 1, 1])):
            col[r < rad] = c
    elif mat == 'heart':  # warden-style glowing soul heart (only shown in god mode)
        r = np.hypot(s - .5, t - .5)
        col = np.zeros((h, w, 3)) + np.array([.3, .2, .02])
        for rad, c in ((.48, [.75, .5, .05]), (.38, [1, .78, .12]), (.26, [1, .93, .45]), (.13, [1, 1, .95])):
            col[r < rad] = c
        v = ridge(P, .9, 31, .1)
        col = np.where((v[..., None] > .6) & (r[..., None] > .26), np.array([.35, .2, .02]), col)
    elif mat == 'rib':  # pale ribs over a see-through chest (alpha cut-out between ribs)
        col = ramp(np.clip(.5 + n2 * .3, 0, .999), BONE if not god else hexramp('#3a3226', '#51473a', '#6e6250'))
        return col, rib_alpha(s, t, cube)
    else:
        col = np.zeros((h, w, 3)) + .5

    # ---- stage overlays
    if p2 and mat not in ('eye', 'core', 'heart', 'mouth'):
        reach = {1: 9, 2: 24, 3: 99}[stage]
        crack = np.maximum(ridge(P, .09, 41, .05), ridge(P, .19, 43, .04) * .85)
        fall = np.clip((reach - dist_chest) / 4, 0, 1)
        col = glow_mix(col, np.clip(crack, 0, 1) * fall, halo=.55)
        heat = np.clip(1 - dist_chest / (6 + stage * 3), 0, 1) * .7
        col = col * (1 - heat[..., None]) + np.array([1, .9, .4]) * heat[..., None]
    if p3 and mat not in ('eye', 'core', 'heart', 'mouth'):
        # dark fragments: black flakes that grow as the Titan weakens, edged with embers
        thr = {1: .9, 2: .72, 3: .6}[stage]
        f = fbm(P, .18, 61, 2) + n2 * .15
        flake = f > thr
        ember = (f > thr - .035) & ~flake
        col[flake] = ramp(np.clip(n2[flake] * .9, 0, .999), ASH)
        col[ember] = [1, .55, .08]
        crack = ridge(P, .13, 47, .035) * np.clip((40 - dist_chest) / 10 + stage, 0, 1)
        col = glow_mix(col, np.clip(crack, 0, 1), color=np.array([1, 1, .7]), halo=.3)
    if god and mat not in ('eye', 'core', 'heart'):
        # yellow lightning veins running through the black body, densest around the heart
        dens = np.clip(1.2 - dist_chest / 40, .45, 1.2)
        v = np.maximum(ridge(P, .075, 71, .05 * dens), ridge(P, .16, 73, .04 * dens) * .9)
        v = np.maximum(v, ridge(P, .3, 77, .03) * .55)
        col = glow_mix(col, np.clip(v * 1.15, 0, 1), color=np.array([1, .85, .15]), core=np.array([1, 1, .8]), halo=.7)
    if mat == 'tendril':
        return col, tendril_alpha(P)
    return col, None


BRONZE = hexramp('#24150a', '#33200d', '#452b11', '#593816', '#6e461b', '#855521', '#9c6528')
GLOWY = np.array([1, .86, .3])
WHITE = np.array([1, 1, .85])


def paint_god(mat, P, N, s, t, w, h, n1, n2, rim, dist_chest, cube, fname):
    """Spark God: bronze-gold armour outlined in glowing light, like a lit-up statue."""
    edge_px = np.minimum.reduce([s * w, (1 - s) * w, t * h, (1 - t) * h])  # texels to the nearest face edge
    outline = edge_px < 1.0
    if mat == 'band':  # glowing rings around the arms
        col = np.zeros((h, w, 3)) + GLOWY
        col[(t > .3) & (t < .7)] = WHITE
        return col, None
    if mat in ('halo', 'crest', 'blade', 'staff', 'ribbon'):
        col = ramp(np.clip(.4 + n2 * .5, 0, .999), hexramp('#f0a01c', '#ffb52e', '#ffc640', '#ffd455', '#ffe070'))
        if min(w, h) >= 4:
            col[outline] = np.array([1, .93, .6])
        return col, None
    if mat == 'disc':  # big round glowing chest core
        r = np.hypot(s - .5, t - .5)
        col = np.zeros((h, w, 3))
        for rad, c in ((.5, [.95, .62, .1]), (.44, [1, .8, .22]), (.36, [1, .9, .45]), (.25, [1, .96, .7]), (.12, [1, 1, .95])):
            col[r < rad] = c
        col[(np.abs(r - .4) < .025)] = [1, .7, .15]
        if fname in ('north', 'south'):
            return col, (r < .5).astype(float)
        return col, None
    if mat in ('eye',):
        col = np.zeros((h, w, 3)) + WHITE
        return col, None
    if mat == 'mouth':
        return np.zeros((h, w, 3)) + GLOWY, None
    if mat == 'core':
        return np.zeros((h, w, 3)) + WHITE, None
    # armour body
    r = BRONZE
    v = .3 + n1 * .45 + n2 * .15 + (P[..., 1] / 64) * .15 - rim * .5
    col = ramp(np.clip(v, 0, .999), r)
    # plate seams glow
    course = np.floor(P[..., 1] / 8.0)
    seam = ((P[..., 1] % 8.0) < .9) & (abs(N[1]) < .5) & (mat in ('skin', 'skin_dark', 'armor'))
    col[seam] = GLOWY * .9
    # glowing rings around the arms (like the bands in the statue)
    if mat == 'skin' and abs(P[..., 0]).mean() > 10 and P[..., 1].mean() < 42:
        band = (np.abs(((P[..., 1] - 8) % 9) - 4.5) > 3.9) & (abs(N[1]) < .5)
        col[band] = GLOWY
    # V of light running down from the chest core on the torso front
    if fname == 'north' and abs(P[..., 0]).mean() < 13 and P[..., 1].mean() < 37:
        y = P[..., 1]
        x = np.abs(P[..., 0])
        v1 = (np.abs(x - (y - 4) * .26) < .8) & (y > 4) & (y < 36)
        v2 = (np.abs(x - (y - 4) * .14) < .6) & (y > 8) & (y < 36)
        col[v1 | v2] = GLOWY
    col[outline] = GLOWY       # every plate edge outlined in light
    return col, (tendril_alpha(P) if mat == 'tendril' else None)


def tendril_alpha(P):
    """Curved, scalloped lobe sweeping up and out from the side of the head."""
    u = np.abs(P[..., 0]) - 10.5                  # 0 at the head, 13.5 at the tip
    yc = 55 + u * .55
    th = 4.6 * (1 - u / 14.5) + 1.0 + .6 * np.sin(u * 1.4)
    return (np.abs(P[..., 1] - yc) < th).astype(float)


def rib_alpha(s, t, cube):
    ss = 1 - s if cube.get('mirrored') else s
    ribs = ((t * 5.5) % 1 < .42) & (ss > .08)             # thin horizontal ribs
    spine = ss > .9                                       # sternum along the middle
    curve = ss < .12 + .25 * np.abs(t - .5)               # outer edge curves in
    a = (ribs | spine) & ~curve
    return a.astype(float)


def paint(model, variant, stage=0):
    global CHEST
    CHEST = model['chest']
    W, H = model['tex']
    img = np.zeros((H, W, 4))
    for bname, _, _, cubes in model['bones']:
        for ci, c in enumerate(cubes):
            for fname, (tl, tr, bl, n, w, h) in faces(c).items():
                x, y, tw, th = model['place'][(bname, ci, fname)]
                jj, ii = np.mgrid[0:th, 0:tw]
                s = (ii + .5) / tw
                t = (jj + .5) / th
                P = tl + s[..., None] * (tr - tl) + t[..., None] * (bl - tl)
                col, alpha = paint_face(c['mat'], P, n, s, t, variant, stage, c, fname)
                img[y:y + th, x:x + tw, :3] = col
                img[y:y + th, x:x + tw, 3] = 1 if alpha is None else alpha
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGBA')


def to_frame(p):  # model -z is forward, model -x is the Titan's right; result in blocks
    return [round(-p[2] / 16, 2), round(-p[0] / 16, 2), round(p[1] / 16, 2)]


def centers(cubes):
    return [np.array(c['origin']) + np.array(c['size']) / 2 for c in cubes]


def write_anchors():
    B = {b[0]: b for b in CLASSIC['bones']}
    eyes = [to_frame(p) for p in centers(B['sparkmod_glowing_eyes'][3])]
    rocks = {}
    for g, lvl in (('a', 1), ('b', 2), ('c', 3)):
        cubes = [c for name, _, _, cs in CLASSIC['bones'] if name.startswith(f'rocks_{g}_') for c in cs]
        rocks[lvl] = [to_frame(p) for p in centers(cubes)]
    chest = to_frame(CLASSIC['chest'])
    G = {b[0]: b for b in GOD['bones']}
    geyes = [to_frame(p) for p in centers(G['sparkmod_glowing_eyes'][3])]
    js = ('// Generated by tools/build_titan.py - effect anchor points, [forward, right, up] in blocks at scale 1.\n'
          f'export const EYES={json.dumps(eyes)};\nexport const CHEST={json.dumps(chest)};\n'
          f'export const ROCKS={json.dumps(rocks)};\n'
          f'export const GOD_EYES={json.dumps(geyes)};\nexport const GOD_CHEST={json.dumps(to_frame(GOD["chest"]))};\n'
          f'export const HALO={json.dumps({"center": to_frame((0, 59, 9.7)), "radius": round(21 / 16, 2)})};\n'
          f'export const SWORD_TIP={json.dumps(to_frame((-17.6, 22, -58)))};\n')
    open(BP + 'scripts/titan_model.js', 'w').write(js)


if __name__ == '__main__':
    E = RP + 'textures/entity/'
    for m in (CLASSIC, GOD):
        build_atlas(m)
        write_geo(m)
    write_anchors()
    paint(CLASSIC, 'p1').save(E + 'bolt_titan.png')
    for st, name in ((1, 'low1'), (2, 'low2'), (3, 'low')):
        paint(CLASSIC, 'p2', st).save(E + f'bolt_titan_{name}.png')
    for st in (1, 2, 3):
        paint(CLASSIC, 'p3', st).save(E + f'bolt_titan_p3_{st}.png')
    paint(GOD, 'god', 3).save(E + 'bolt_titan_god.png')
    for m in (CLASSIC, GOD):
        print(m['name'], 'faces', len(m['place']), 'texels', sum(r[2] * r[3] for r in m['place'].values()))
