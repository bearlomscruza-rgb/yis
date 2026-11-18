"""Builds the V222 Bolt Titan: a Warden-style body at 1.3x Warden size.

python3 tools/build_titan.py
Writes (into SparkMod_V223_Resources):
  models/entity/bolt_titan.geo.json                 the model
  textures/entity/bolt_titan.png                    phase 1 (stone, moss, robe, gold, skulls)
  textures/entity/bolt_titan_low1/low2/low.png      phase 2 (amber, cracks spread from the chest)
  textures/entity/bolt_titan_p3_1/_2/_3.png         phase 3 (yellow; black fragments as HP drops)
  textures/entity/bolt_titan_god.png                Spark God (black with yellow lightning veins)
and SparkMod_V223_Behavior/scripts/titan_model.js  (anchor points the scripts use for effects).

Every face gets its own rectangle in the texture, and every texel is painted from its real
3D position on the body, so patterns (cracks, veins, moss) run continuously across faces.
"""
import json, math
import numpy as np
from PIL import Image

RP = 'SparkMod_V223_Resources/'
BP = 'SparkMod_V223_Behavior/'
TEX_W, TEX_H = 256, 256

# ----------------------------------------------------------------------------- model
# Units are model pixels (16 = 1 block). Front of the model is -z. A cube is
# (origin, size, material, extra) where extra may hold inflate / density.
def C(o, s, mat, **kw):
    return dict(origin=list(o), size=list(s), mat=mat, **kw)


def mirror(c):
    o, s = c['origin'], c['size']
    m = dict(c)
    m['origin'] = [-(o[0] + s[0]), o[1], o[2]]
    m['mirrored'] = not c.get('mirrored', False)
    return m


R_LEG = [C((-9.5, 0, -4), (8, 17, 8), 'skin'), C((-10, 0, -5.5), (9, 3, 10), 'skin_dark')]
R_ARM = [C((-21, 6, -5.2), (10.4, 36, 10.4), 'skin'),
         C((-21, 15, -5.2), (10.4, 3, 10.4), 'gold', inflate=.4),
         C((-21, 3.2, -6.2), (3.2, 3, 3), 'skin_dark'), C((-17.6, 3.2, -6.2), (3.2, 3, 3), 'skin_dark'),
         C((-14.2, 3.2, -6.2), (3.0, 3, 3), 'skin_dark')]
BODY = [C((-12, 17, -7), (24, 27, 14), 'skin'),
        C((-12, 17, -7), (24, 19, 14), 'robe', inflate=.6),
        C((-13, 40, -7.5), (26, 4.5, 15), 'robe', inflate=.2),
        C((-12, 24, -7), (24, 2.6, 14), 'gold', inflate=.9),
        C((-4.5, 31.5, -7.7), (2, 9, .6), 'gold'), C((2.5, 31.5, -7.7), (2, 9, .6), 'gold')]
SKULLS = [C((x, 22.6, -9.6), (3.2, 3.6, 2.2), 'skull', density=4) for x in (-10, -5.4, 2.2, 6.8)]
HEAD = [C((-10.5, 44, -6.5), (21, 20, 13), 'skin'),
        C((-11.2, 60, -7.2), (22.4, 4.5, 14.4), 'robe'),
        C((-10.5, 57, -7.3), (21, 2, 1), 'skin_dark'),
        C((-6.5, 46, -6.95), (13, 3.2, .5), 'mouth', density=2)]
EYES = [C((-7.6, 52, -7.1), (3.6, 2.4, .7), 'eye', density=5)]
TENDRIL_R = [C((-24, 51, 0), (13.5, 16, 0), 'tendril')]
CORE = [C((-2.5, 33.5, -8.5), (5, 5, 1.2), 'core', density=4), C((-1.5, 34.5, -9.0), (3, 3, .6), 'core', density=4)]
# Spark God parts (only visible in god mode): a big round glowing chest core, a halo behind the
# head, a crest, a curved sword in the right hand and a long spear in the left. Built from small
# cubes like a voxel statue.
HEART = [C((-6.5, 28.5, -9.4), (13, 13, 1.6), 'disc', density=2)]
HALO = [C((math.cos(a) * 17 - 1.3, 57 + math.sin(a) * 17 - 1.3, 8), (2.6, 2.6, 1.2), 'halo')
        for a in [i * 2 * math.pi / 30 for i in range(30)]]
CREST = [C((-0.9, 64.6, -1), (1.8, 7.5, 1.8), 'crest'), C((-3, 68.6, -1), (6, 1.6, 1.8), 'crest')]
SWORD = ([C((-18.3, 2.2, -8.4), (5.2, 4.6, 1.4), 'crest'),                      # guard
          C((-16.6, 3.6, -11.4), (1.8, 1.8, 3), 'crest')]                       # pommel-side grip
         + [C((-16.3, 3.2 + (i / 17) ** 2 * 13, -10 - i * 2.4), (1.2, 3.4 - max(0, i - 14) * .8, 2.6), 'blade')
            for i in range(18)])
SPEAR = ([C((15.8 + .38 * (y - 4.5) - 1.1, y, -7.6 - .08 * (y - 4.5)), (2.2, 2.2, 2.2), 'staff')
          for y in [0 + k * 2 for k in range(34)]]
         + [C((15.8 + .38 * (y - 4.5) - w / 2, y, -7.6 - .08 * (y - 4.5) - .3), (w, 2.2, 2.8), 'blade')
            for y, w in ((68, 5), (70, 4.2), (72, 3.2), (74, 2.2), (76, 1.2))])
ROCKS = {  # group: [(bone, cube)]
    'a': [('body', C((-8, 21, 6.6), (5, 5, 4), 'rock')), ('right_arm', C((-23.2, 12, -2), (4, 5, 4.5), 'rock')),
          ('right_leg', C((-11.5, 8, 2), (4, 4.5, 4), 'rock'))],
    'b': [('body', C((3, 27, 6.6), (6, 6, 4.2), 'rock')), ('left_arm', C((19.2, 12, -2), (4, 5, 4.5), 'rock')),
          ('left_leg', C((7.5, 8, 2), (4, 4.5, 4), 'rock'))],
    'c': [('body', C((-15, 41, -2.5), (7, 6.5, 7), 'rock')), ('body', C((8, 41, -2), (7, 6, 6.5), 'rock')),
          ('right_arm', C((-23.5, 28, -1.5), (4.5, 6, 5), 'rock')), ('left_arm', C((19, 27, -1.5), (4.5, 6, 5), 'rock')),
          ('head', C((-3, 64.3, -2), (6, 3, 5), 'rock'))],
}
BONES = [  # name, parent, pivot, cubes
    ('root', None, (0, 0, 0), []),
    ('body', 'root', (0, 17, 0), BODY + SKULLS),
    ('head', 'body', (0, 44, 0), HEAD),
    ('sparkmod_glowing_eyes', 'head', (0, 44, 0), EYES + [mirror(c) for c in EYES]),
    ('right_tendril', 'head', (-10.5, 59, 0), TENDRIL_R),
    ('left_tendril', 'head', (10.5, 59, 0), [mirror(c) for c in TENDRIL_R]),
    ('chest_core', 'body', (0, 36, -8), CORE),
    ('heart', 'body', (0, 35, -8.6), HEART),
    ('god_halo', 'head', (0, 57, 8.6), HALO),
    ('god_crest', 'head', (0, 64.6, 0), CREST),
    ('god_sword', 'right_arm', (-16, 4, -8), SWORD),
    ('god_spear', 'left_arm', (16, 4, -8), SPEAR),
    ('right_arm', 'body', (-16, 42, 0), R_ARM),
    ('left_arm', 'body', (16, 42, 0), [mirror(c) for c in R_ARM]),
    ('right_leg', 'root', (-5.5, 17, 0), R_LEG),
    ('left_leg', 'root', (5.5, 17, 0), [mirror(c) for c in R_LEG]),
]
SHORT = {'body': 'body', 'right_arm': 'rarm', 'left_arm': 'larm', 'right_leg': 'rleg', 'left_leg': 'lleg', 'head': 'head'}
PIVOT = {b[0]: b[2] for b in BONES}
for g, items in ROCKS.items():
    by = {}
    for bone, cube in items:
        by.setdefault(bone, []).append(cube)
    for bone, cubes in by.items():
        BONES.append((f'rocks_{g}_{SHORT[bone]}', bone, PIVOT[bone], cubes))

# ----------------------------------------------------------------------------- faces + atlas
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


def build_atlas():
    rects = []  # (bone, cube_index, face, tw, th)
    for bname, _, _, cubes in BONES:
        for ci, c in enumerate(cubes):
            d = c.get('density', 1)
            for fname, (_, _, _, _, w, h) in faces(c).items():
                tw, th = max(1, math.ceil(w * d - 1e-6)), max(1, math.ceil(h * d - 1e-6))
                rects.append([bname, ci, fname, tw, th])
    rects.sort(key=lambda r: -r[4])
    x = y = shelf = 0
    place = {}
    for r in rects:
        bname, ci, fname, tw, th = r
        if x + tw > TEX_W:
            x, y, shelf = 0, y + shelf, 0
        place[(bname, ci, fname)] = (x, y, tw, th)
        x += tw
        shelf = max(shelf, th)
    assert y + shelf <= TEX_H, f'atlas overflow {y + shelf}'
    return place


PLACE = build_atlas()


def write_geo():
    bones = []
    for bname, parent, pivot, cubes in BONES:
        b = {'name': bname, 'pivot': list(pivot)}
        if parent:
            b['parent'] = parent
        out = []
        for ci, c in enumerate(cubes):
            uv = {}
            for fname in faces(c):
                x, y, tw, th = PLACE[(bname, ci, fname)]
                uv[fname] = {'uv': [x, y], 'uv_size': [tw, th]}
            cube = {'origin': [round(v, 3) for v in c['origin']], 'size': [round(v, 3) for v in c['size']], 'uv': uv}
            if c.get('inflate'):
                cube['inflate'] = c['inflate']
            out.append(cube)
        if out:
            b['cubes'] = out
        bones.append(b)
    geo = {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.sparkmod.bolt_titan', 'texture_width': TEX_W, 'texture_height': TEX_H,
                        'visible_bounds_width': 6, 'visible_bounds_height': 6, 'visible_bounds_offset': [0, 2.5, 0]},
        'bones': bones}]}
    json.dump(geo, open(RP + 'models/entity/bolt_titan.geo.json', 'w'), indent=1)


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
    if mat in ('halo', 'crest', 'blade', 'staff', 'disc'):
        return np.zeros((h, w, 3)) + GOLD[2], None
    if mat in ('skin', 'skin_dark', 'rock', 'tendril'):
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
                if mat == 'rock':
                    m = m + .2
                mask = m > .78
                col[mask] = ramp(np.clip(fbm(P, .6, 6) * 1.3 - .15, 0, .999), MOSS)[mask]
            if p2:
                col[seam] = np.where(dist_chest[seam, None] < {1: 0, 2: 22, 3: 99}[stage], MID * .95, col[seam])
    elif mat == 'robe':
        fold = np.sin((P[..., 0] * .55 + P[..., 2] * .55) + np.sin(P[..., 1] * .18) * .8) * .5 + .5
        v = .22 + fold * .3 + n2 * .25 - rim
        r = {'p1': ROBE, 'p2': OCHRE, 'p3': YEL_D, 'god': VOID}[variant]
        col = ramp(np.clip(v, 0, .999), r)
        if fname not in ('up', 'down') and not god:
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
    if mat in ('halo', 'crest', 'blade', 'staff'):
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
    seam = ((P[..., 1] % 8.0) < .9) & (abs(N[1]) < .5) & (mat in ('skin', 'skin_dark'))
    col[seam] = GLOWY * .9
    # glowing rings around the arms (like the bands in the statue)
    if mat == 'skin' and abs(P[..., 0]).mean() > 10 and P[..., 1].mean() < 42:
        band = (np.abs(((P[..., 1] - 8) % 9) - 4.5) > 3.9) & (abs(N[1]) < .5)
        col[band] = GLOWY
    # V of light running down from the chest core on the torso front
    if fname == 'north' and P[..., 2].mean() < -6.4 and abs(P[..., 0]).mean() < 13:
        y = P[..., 1]
        x = np.abs(P[..., 0])
        v1 = (np.abs(x - (y - 17) * .55) < .9) & (y > 17) & (y < 30)
        v2 = (np.abs(x - (y - 17) * .55 - 3.5) < .7) & (y > 17) & (y < 30)
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


def paint(variant, stage=0):
    img = np.zeros((TEX_H, TEX_W, 4))
    for bname, _, _, cubes in BONES:
        for ci, c in enumerate(cubes):
            for fname, (tl, tr, bl, n, w, h) in faces(c).items():
                x, y, tw, th = PLACE[(bname, ci, fname)]
                jj, ii = np.mgrid[0:th, 0:tw]
                s = (ii + .5) / tw
                t = (jj + .5) / th
                P = tl + s[..., None] * (tr - tl) + t[..., None] * (bl - tl)
                col, alpha = paint_face(c['mat'], P, n, s, t, variant, stage, c, fname)
                img[y:y + th, x:x + tw, :3] = col
                img[y:y + th, x:x + tw, 3] = 1 if alpha is None else alpha
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGBA')


def write_anchors():
    """Effect anchor points for the scripts, in blocks: [forward, right, up]."""
    def to_frame(p):  # model -z is forward, model -x is the Titan's right
        return [round(-p[2] / 16, 2), round(-p[0] / 16, 2), round(p[1] / 16, 2)]
    centers = lambda cubes: [np.array(c['origin']) + np.array(c['size']) / 2 for c in cubes]
    rocks = {}
    for g, items in ROCKS.items():
        rocks[{'a': 1, 'b': 2, 'c': 3}[g]] = [to_frame(p) for p in centers([c for _, c in items])]
    eyes = [to_frame(p) for p in centers(EYES + [mirror(c) for c in EYES])]
    eyes = [[e[0] + .05, e[1], e[2]] for e in eyes]
    chest = to_frame(centers(CORE[:1])[0])
    chest[0] += .05
    js = ('// Generated by tools/build_titan.py - effect anchor points on the V222 Titan model.\n'
          '// Each point is [forward, right, up] in blocks at scale 1.\n'
          f'export const EYES={json.dumps(eyes)};\nexport const CHEST={json.dumps(chest)};\n'
          f'export const ROCKS={json.dumps(rocks)};\nexport const HEIGHT={round(68 / 16, 2)};\n'
          f'export const HALO={json.dumps({"center": to_frame((0, 57, 8.6)), "radius": round(17 / 16, 2)})};\n')
    open(BP + 'scripts/titan_model.js', 'w').write(js)


if __name__ == '__main__':
    write_geo()
    write_anchors()
    E = RP + 'textures/entity/'
    paint('p1').save(E + 'bolt_titan.png')
    for st, name in ((1, 'low1'), (2, 'low2'), (3, 'low')):
        paint('p2', st).save(E + f'bolt_titan_{name}.png')
    for st in (1, 2, 3):
        paint('p3', st).save(E + f'bolt_titan_p3_{st}.png')
    paint('god', 3).save(E + 'bolt_titan_god.png')
    used = sum(r[2] * r[3] for r in PLACE.values())
    print('built: faces', len(PLACE), 'texels used', used, 'of', TEX_W * TEX_H)
