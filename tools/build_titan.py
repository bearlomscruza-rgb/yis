"""Builds the Bolt Titan models and skins (V228).

python3 tools/build_titan.py

Two models:
  * classic  - the original Bolt Titan (horns, robe, skulls, rocks, chest core), read from
               tools/titan_classic.geo.json, used for phases 1-3.
  * god      - the Spark God statue (halo, crest, ribbons, big glowing chest, sword and spear),
               used while god mode is active.
Each face gets its own rectangle in the texture and every texel is painted from its real 3D
position on the body, so patterns run smoothly and continuously across the whole model.

Writes into SparkMod_V247_Resources:
  models/entity/bolt_titan.geo.json, models/entity/bolt_titan_god.geo.json
  textures/entity/bolt_titan.png (phase 1), bolt_titan_low1/low2/low.png (phase 2 crack stages),
  bolt_titan_p3_1/_2/_3.png (phase 3: yellow, black fragments), bolt_titan_god.png
and SparkMod_V247_Behavior/scripts/titan_model.js (anchor points used by the effects).
"""
import json, math
import numpy as np
from PIL import Image

RP = 'SparkMod_V247_Resources/'
BP = 'SparkMod_V247_Behavior/'


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
            if mat == 'skull':
                continue          # skull belt removed (V228)
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

# ============================================================================ magma golem model
# Phases 1 and 3: a hunched lightning golem - dark storm-rock split by glowing electric cracks,
# huge shoulders with copper lightning rods and lightning bolts crackling up from them, a small
# glowing head sunk between them, carved copper bands on the forearms and giant copper-brick fists.
def flame(x, y, z, sx, sy):
    """Two crossed planes with a cut-out lightning-bolt texture."""
    return [C((x - sx / 2, y, z), (sx, sy, 0), 'flame', density=2), C((x, y, z - sx / 2), (0, sy, sx), 'flame', density=2)]


def rod(x, y, z, hgt):
    """Copper lightning rod: thin pole with a knob on top."""
    return [C((x - .7, y, z - .7), (1.4, hgt, 1.4), 'copper_rod'), C((x - 1.1, y + hgt, z - 1.1), (2.2, 2.2, 2.2), 'copper_rod')]


M_LEG = [C((-10, 2, -4.5), (8, 13, 9), 'magma'), C((-10.5, 0, -6.5), (9, 3.5, 11), 'magma'),
         C((-10.3, 0, -7.6), (2.4, 2.2, 1.6), 'magma'), C((-7.3, 0, -7.6), (2.4, 2.2, 1.6), 'magma'),
         C((-4.3, 0, -7.6), (2.4, 2.2, 1.6), 'magma')]
M_ARM = [C((-27, 21, -6.5), (11, 15, 13), 'magma'),                    # upper arm
         C((-28, 14, -7.5), (13, 7, 15), 'copper_carved'),             # carved copper band
         C((-31, 0, -9.5), (17, 14, 19), 'magma'),                     # fist
         C((-31.6, 1, -10.4), (17.6, 12, 1.2), 'copper_brick'),        # brick knuckle plate
         C((-31.8, 1, -9), (1.2, 12, 15), 'copper_brick'),             # brick side plate
         C((-30, 14, -10), (4, 3, 4), 'magma'), C((-24, 14, -10), (4, 3, 4), 'magma')]   # knuckle spikes
M_SHOULDER = [C((-26, 33, -9.5), (14, 13, 18), 'magma'),
              C((-25, 46, -6), (5, 3.5, 6), 'magma'), C((-19.5, 46, -3), (4, 2.5, 5), 'magma')]   # jagged top
MAGMA = dict(name='magma', tex=(256, 256), chest=np.array([0, 34, -9]),
             geo_id='geometry.sparkmod.bolt_titan_magma', file='bolt_titan_magma.geo.json', bones=[
    ('root', None, (0, 0, 0), []),
    ('body', 'root', (0, 15, 0), [C((-10, 15, -6), (20, 11, 12), 'magma'),          # waist
                                  C((-13, 25, -8.5), (26, 17, 17), 'magma'),        # chest
                                  C((-6, 27, -9.4), (12, 9, 1.2), 'magma'),         # chest plate
                                  C((-11, 16, -6.8), (22, 3, 13.6), 'copper_brick')]  # brick belt
     + M_SHOULDER + [mirror(c) for c in M_SHOULDER]),
    ('head', 'body', (0, 34, -6), [C((-5.5, 31, -12.5), (11, 10, 10), 'magma'),
                                   C((-6, 39.5, -13), (12, 2, 6), 'magma'),
                                   C((-3.5, 32.5, -12.9), (7, 1.8, .6), 'lava_mouth', density=3)]),
    ('sparkmod_glowing_eyes', 'head', (0, 34, -6), [C((-4.4, 36, -12.9), (3, 1.6, .5), 'lava_eye', density=4),
                                                    C((1.4, 36, -12.9), (3, 1.6, .5), 'lava_eye', density=4)]),
    ('flames', 'body', (0, 46, 0), flame(-20, 46, -3, 10, 18) + flame(-15, 45.5, 3, 7, 12) +
                                    flame(20, 46, -3, 10, 18) + flame(15, 45.5, 3, 7, 12)
                                    + rod(-23.5, 46, 1, 9) + rod(23.5, 46, 1, 9)),
    ('right_arm', 'body', (-19, 38, 0), M_ARM),
    ('left_arm', 'body', (19, 38, 0), [mirror(c) for c in M_ARM]),
    ('right_leg', 'root', (-6, 15, 0), M_LEG),
    ('left_leg', 'root', (6, 15, 0), [mirror(c) for c in M_LEG]),
    # chunks of crust that crumble away at 60% health
    ('rocks_a_body', 'body', (0, 15, 0), [C((-9, 30, 8), (6, 6, 3), 'magma'), C((3, 34, 8), (7, 5, 3), 'magma'),
                                          C((-23, 46, 2), (5, 4, 5), 'magma'), C((18, 46, 2), (5, 4, 5), 'magma')]),
])


# ============================================================================ god model
# Spark God: a sand-gold block golem carved with spiral engravings - big shoulder blocks, white
# cloth sleeves and fringed skirt, floating carved fists with light-blue gems, a grey stone crest,
# a gem ornament on the belt (it pulses with the heartbeat) and a glowing winged halo above.
def ring(cx, cy, z, r, n, size, mat, a0=0, a1=2 * math.pi):
    out = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / (n - 1 if a1 - a0 < 2 * math.pi - 1e-6 else n)
        out.append(C((cx + math.cos(a) * r - size / 2, cy + math.sin(a) * r - size / 2, z), (size, size, 1.4), mat))
    return out


def wings():
    """Two downward-curving glowing arcs joined in the middle (a 'W'), with short rays fanning out."""
    out = []
    for side in (-1, 1):
        cx = side * 9
        for i in range(13):
            a = math.pi + math.pi * i / 12                     # lower half of a circle
            x, y = cx + math.cos(a) * 9, 66 + math.sin(a) * 6.5
            out.append(C((x - 1.2, y - 1.2, 8), (2.4, 2.4, 1.2), 'wing'))
            if i % 2 == 0 and 0 < i < 12:                       # rays pointing outward
                for k, sz in ((3.2, 1.6), (5.4, 1.1)):
                    rx, ry = cx + math.cos(a) * (9 + k), 66 + math.sin(a) * (6.5 + k)
                    out.append(C((rx - sz / 2, ry - sz / 2, 8.2), (sz, sz, .8), 'wing'))
            if i in (0, 12):                                     # upward feather tips at the ends
                for k in (2.6, 4.8, 6.6):
                    out.append(C((x - .7 + side * k * .35, y + k - .7, 8.2), (1.4, 1.4, .8), 'wing'))
    return out


G_LEG = [C((-8, 0, -3.5), (7, 12, 7), 'cloth'), C((-8.5, 0, -4.5), (8, 3, 8.5), 'carved')]
G_ARM = [C((-25.5, 27, -7.5), (14, 13, 15), 'carved'),                 # shoulder block
         C((-22, 17, -4), (8, 10.5, 8), 'cloth'),                      # sleeve
         C((-22.5, 16.5, -4.5), (9, 2, 9), 'gold_band'),
         C((-23.5, 2, -5.5), (11, 11, 11), 'carved'),                  # floating fist
         C((-19.2, 6.3, -6.2), (2.4, 2.4, .8), 'gem')]
GOD = dict(name='god', tex=(256, 256), chest=np.array([0, 17.5, -9]),
           geo_id='geometry.sparkmod.bolt_titan_god', file='bolt_titan_god.geo.json', bones=[
    ('root', None, (0, 0, 0), []),
    ('body', 'root', (0, 14, 0), [
        C((-10.5, 9, -7), (21, 9, 14), 'fringe'),                      # cloth skirt with fringe
        C((-11, 17, -7.5), (22, 3, 15), 'gold_band'),                  # belt
        C((-11.5, 20, -8), (23, 18, 16), 'carved')]),                  # torso
    ('heart', 'body', (0, 18.5, -8.8), [C((-3, 15.5, -8.9), (6, 6, 1.2), 'ornament', density=3),
                                        C((-1.3, 17.2, -9.4), (2.6, 2.6, .7), 'gem', density=3)]),
    ('head', 'body', (0, 38, 0), [C((-7.5, 38, -7), (15, 14, 13), 'carved_face'),
                                  C((-2, 51.5, -5.5), (4, 8.5, 10), 'crest')]),
    ('sparkmod_glowing_eyes', 'head', (0, 38, 0), [C((-5, 44, -7.4), (3.2, 1.7, .5), 'eye', density=5),
                                                   C((1.8, 44, -7.4), (3.2, 1.7, .5), 'eye', density=5)]),
    ('god_halo', 'body', (0, 64, 8), wings()),
    ('right_arm', 'body', (-15, 34, 0), G_ARM),
    ('left_arm', 'body', (15, 34, 0), [mirror(c) for c in G_ARM]),
    ('right_leg', 'root', (-4.5, 12, 0), G_LEG),
    ('left_leg', 'root', (4.5, 12, 0), [mirror(c) for c in G_LEG]),
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


REST = {('magma', 'right_arm'): [-18, 0, 24], ('magma', 'left_arm'): [-18, 0, -24]}


def write_geo(model):
    bones = []
    for bname, parent, pivot, cubes in model['bones']:
        b = {'name': bname, 'pivot': [round(v, 3) for v in pivot]}
        if (model['name'], bname) in REST:
            b['rotation'] = REST[(model['name'], bname)]
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

    if variant in ('m1', 'm3'):
        return paint_magma(mat, P, N, s, t, w, h, n1, n2, rim, variant, stage, fname)
    if god:
        return paint_god(mat, P, N, s, t, w, h, n1, n2, rim, dist_chest, cube, fname)
    if mat in ('carved', 'carved_face', 'gold_band', 'ornament', 'cloth', 'fringe', 'gem', 'crest', 'wing'):
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
    elif mat in ('skin', 'skin_dark', 'rock'):
        if god:
            col = ramp(np.clip(.2 + n1 * .5 + n2 * .2 - rim, 0, .999), VOID)
        elif p3:
            r = YEL if mat == 'skin' else YEL_D
            col = ramp(np.clip(.25 + n1 * .5 + n2 * .15 + shade - rim, 0, .999), r)
        else:
            r = {'skin': STONE, 'skin_dark': STONE_D, 'rock': STONE_D}[mat]
            if p2:
                r = {'skin': AMBER, 'skin_dark': AMBER_D, 'rock': AMBER_D}[mat]
            col, seam = stone(r)
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
    return col, None


BRONZE = hexramp('#24150a', '#33200d', '#452b11', '#593816', '#6e461b', '#855521', '#9c6528')
GLOWY = np.array([1, .86, .3])
WHITE = np.array([1, 1, .85])


ROCK = hexramp('#121319', '#1a1c24', '#23262f', '#2d303b', '#373b48', '#424656')
LAVA = np.array([1, .82, .18])          # electric yellow
LAVA_HOT = np.array([1, 1, .82])        # white-hot core of the cracks
COPPER = hexramp('#7a3a24', '#9a4c2f', '#b8613d', '#d27a51', '#e69468', '#f2ad83')


def paint_magma(mat, P, N, s, t, w, h, n1, n2, rim, variant, stage, fname):
    """m1 = phase 1 (crust mostly intact), m3 = phase 3 (hotter; more lava as HP drops)."""
    heat = {('m1', 0): .0, ('m3', 1): .25, ('m3', 2): .5, ('m3', 3): .8}[(variant, stage)]
    if mat == 'flame':  # zig-zag lightning bolt (t=0 top, t=1 bottom)
        pts = np.array([(.62, 0), (.3, .38), (.55, .4), (.25, .78), (.5, .8), (.35, 1)])
        cx = np.interp(t, pts[:, 1], pts[:, 0])
        width = .13 * (1 - np.abs(t - .45) * .8) + .03
        d = np.abs(s - cx)
        shape = d < width
        col = np.zeros((h, w, 3)) + [1, .82, .2]
        col[d < width * .5] = [1, 1, .85]
        return col, shape.astype(float)
    if mat == 'copper_rod':
        col = ramp(np.clip(.4 + n2 * .4 + (1 - t) * .2, 0, .999), COPPER)
        col[np.abs(s - .5) < .12] = COPPER[5]
        return col, None
    if mat in ('lava_eye', 'lava_mouth'):
        col = np.zeros((h, w, 3)) + LAVA_HOT
        if mat == 'lava_mouth':
            col[(np.floor(s * 7) % 2 == 0) & ((t < .3) | (t > .7))] = ROCK[1]
        return col, None
    if mat == 'copper_brick':
        rows = np.floor(t * h / 3.2)
        bx = (s * w + (rows % 2) * 2.5) % 5
        mortar = ((t * h / 3.2) % 1 < .25) | (bx < .8)
        col = ramp(np.clip(.4 + n2 * .45 + (1 - t) * .15 - rim * .5, 0, .999), COPPER)
        hot = vnoise(P, .25, 13) > .55 - heat * .3
        col[mortar] = np.where(hot[mortar, None], LAVA, ROCK[1])
        return col, None
    if mat == 'copper_carved':
        col = ramp(np.clip(.45 + n2 * .35 - rim * .6, 0, .999), COPPER)
        tx, ty = max(1, round(w / 8)), 1
        g = spiral((s * tx) % 1, t, turns=max(1, int(min(w / tx, h) / 4.6)))
        col[np.roll(g, 1, axis=0) & ~g] = COPPER[5]
        col[g] = ROCK[1]
        return col, None
    # storm-rock with glowing electric cracks
    col = ramp(np.clip(.25 + n1 * .5 + n2 * .2 - rim * .5, 0, .999), ROCK)
    crack = np.maximum(ridge(P, .085, 101, .032 + heat * .05), ridge(P, .19, 103, .022 + heat * .035) * .9)
    pools = np.clip((fbm(P, .14, 107, 2) - (.8 - heat * .3)) * 6, 0, 1)   # charged patches
    g = np.clip(np.maximum(crack, pools), 0, 1)
    col = col * (1 - g[..., None] * .7) + LAVA * g[..., None] * .7
    col = np.where(g[..., None] > .78, LAVA_HOT, np.where(g[..., None] > .5, LAVA, col))
    edge = np.minimum.reduce([s * w, (1 - s) * w, t * h, (1 - t) * h]) < .9
    col[edge & (g < .3)] = col[edge & (g < .3)] * .75
    return col, None


SAND = hexramp('#a8772f', '#b9873a', '#c99846', '#d6a752', '#e2b660', '#ecc571', '#f4d486')
GROOVE = np.array([.47, .32, .13])
LIGHT = np.array([.98, .87, .58])
CLOTH = hexramp('#b9b8c4', '#cdccd6', '#dddce4', '#e9e8ee', '#f4f3f7')
SKY = np.array([.5, .82, .94])


def spiral(u, v, turns=3):
    """Square spiral (Greek-key) groove mask on a unit square."""
    x, y = u * 2 - 1, v * 2 - 1
    r = np.maximum(np.abs(x), np.abs(y))
    ring = r * turns
    k = np.floor(ring)
    line = (ring - k) < .34
    ang = (np.arctan2(y, x) + np.pi) / (2 * np.pi)          # 0..1 around the square
    gap = ((ang - k * .25) % 1) < .12                     # opening rotates each ring -> spiral
    return line & ~gap & (r < .97)


def paint_god(mat, P, N, s, t, w, h, n1, n2, rim, dist_chest, cube, fname):
    if mat in ('carved', 'carved_face', 'gold_band', 'ornament'):
        col = ramp(np.clip(.38 + n1 * .35 + n2 * .2 + (1 - t) * .12 - rim * .6, 0, .999), SAND)
        if mat in ('carved', 'carved_face'):
            tx, ty = max(1, round(w / 24)), max(1, round(h / 24))
            u, v = (s * tx) % 1, (t * ty) % 1
            g = spiral(u, v, turns=max(1, int(min(w / tx, h / ty) / 4.6)))
            below = np.roll(g, 1, axis=0) & ~g                 # highlight under each groove
            col[below] = LIGHT
            col[g] = GROOVE
            if mat == 'carved_face' and fname == 'north':     # brow and mouth carving on the face
                col[(t > .3) & (t < .36) & (np.abs(s - .5) < .4)] = GROOVE
                col[(t > .72) & (t < .77) & (np.abs(s - .5) < .22)] = GROOVE
                col[(t > .38) & (t < .66)] = col[(t > .38) & (t < .66)] * .9 + .02
        if mat == 'gold_band':
            col[(t < .2) | (t > .8)] = LIGHT
        if mat == 'ornament':                                 # diamond-shaped gold setting
            d = np.abs(s - .5) + np.abs(t - .5)
            col[d > .44] = LIGHT
            return col, (d < .5).astype(float) if fname in ('north', 'south') else None
        edge = np.minimum.reduce([s * w, (1 - s) * w, t * h, (1 - t) * h]) < .9
        col[edge] = col[edge] * .78                           # crisp block edges
        return col, None
    if mat in ('cloth', 'fringe'):
        fold = np.sin(P[..., 0] * .9 + P[..., 2] * .9) * .5 + .5
        col = ramp(np.clip(.35 + fold * .35 + n2 * .2 - rim * .5, 0, .999), CLOTH)
        if fname not in ('up', 'down'):
            trim = (t < .1) if mat == 'fringe' else ((t < .12) | (t > .88))
            col[trim] = SAND[4]
            col[trim & ((s * w) % 4 < 1)] = SKY            # little blue stitches in the gold trim
        alpha = None
        if mat == 'fringe' and fname not in ('up', 'down'):
            strand = ((s * w) % 2.0) < 1.3
            length = .55 + .4 * vnoise(np.stack([np.floor(s * w / 2), t * 0, t * 0], -1), 1.0, 91)
            alpha = (~((t > length) | ((t > .5) & ~strand))).astype(float)
        return col, alpha
    if mat == 'gem':
        col = np.zeros((h, w, 3)) + SKY
        col[(s < .45) & (t < .45)] = [.85, .97, 1]
        col[(s > .7) | (t > .7)] = [.3, .62, .78]
        return col, None
    if mat == 'crest':
        col = ramp(np.clip(.45 + n2 * .35 + (1 - t) * .2 - rim, 0, .999), hexramp('#9da2aa', '#b4b8bf', '#c9ccd2', '#dcdfe3', '#eceef0'))
        return col, None
    if mat == 'wing':
        col = np.zeros((h, w, 3)) + [1, .93, .62]
        col[(s > .25) & (s < .75) & (t > .25) & (t < .75)] = [1, 1, .9]
        return col, None
    if mat == 'eye':
        return np.zeros((h, w, 3)) + [1, .95, .7], None
    return np.zeros((h, w, 3)) + SAND[3], None


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
    M = {b[0]: b for b in MAGMA['bones']}
    rocks[1] = [to_frame(p) for p in centers(M['rocks_a_body'][3])]      # phase 1 crust chunks
    meyes = [to_frame(p) for p in centers(M['sparkmod_glowing_eyes'][3])]
    flames = [to_frame(p) for p in ((-20, 56, -3), (20, 56, -3), (-15, 52, 3), (15, 52, 3))]
    rods = [to_frame(p) for p in ((-23.5, 57.1, 1), (23.5, 57.1, 1))]
    js = ('// Generated by tools/build_titan.py - effect anchor points, [forward, right, up] in blocks at scale 1.\n'
          f'export const EYES={json.dumps(eyes)};\nexport const CHEST={json.dumps(chest)};\n'
          f'export const ROCKS={json.dumps(rocks)};\n'
          f'export const MAGMA_EYES={json.dumps(meyes)};\nexport const MAGMA_CHEST={json.dumps(to_frame(MAGMA["chest"]))};\n'
          f'export const MAGMA_FLAMES={json.dumps(flames)};\nexport const MAGMA_RODS={json.dumps(rods)};\n'
          f'export const GOD_EYES={json.dumps(geyes)};\nexport const GOD_CHEST={json.dumps(to_frame(GOD["chest"]))};\n'
          f'export const WINGS={json.dumps([to_frame(p) for p in centers([c for c in G["god_halo"][3] if c["size"][0] > 2])][::2])};\n')
    open(BP + 'scripts/titan_model.js', 'w').write(js)


if __name__ == '__main__':
    E = RP + 'textures/entity/'
    for m in (CLASSIC, MAGMA, GOD):
        build_atlas(m)
        write_geo(m)
    write_anchors()
    paint(MAGMA, 'm1').save(E + 'bolt_titan_magma.png')
    for st, name in ((1, 'low1'), (2, 'low2'), (3, 'low')):
        paint(CLASSIC, 'p2', st).save(E + f'bolt_titan_{name}.png')
    for st in (1, 2, 3):
        paint(MAGMA, 'm3', st).save(E + f'bolt_titan_magma_p3_{st}.png')
    paint(GOD, 'god', 3).save(E + 'bolt_titan_god.png')
    for m in (CLASSIC, MAGMA, GOD):
        print(m['name'], 'faces', len(m['place']), 'texels', sum(r[2] * r[3] for r in m['place'].values()))
