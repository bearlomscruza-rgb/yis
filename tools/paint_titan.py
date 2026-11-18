"""Paints the Bolt Titan skins (V220).

python3 tools/paint_titan.py
Writes textures/entity/bolt_titan.png (phase 1), bolt_titan_low.png (phase 2+: glowing yellow)
and bolt_titan_god.png (Spark God) into SparkMod_V220_Resources.

The model maps one rectangle ("patch") of the texture onto every face of a cube, so each patch
is painted as a self-contained, low-noise pixel-art tile with a darker rim (cube edges read clearly)
and colors quantized to a short Minecraft-style shade ramp.
"""
import numpy as np
from PIL import Image

RP = 'SparkMod_V220_Resources/textures/entity/'
rng = np.random.default_rng(220)


def hexramp(*hs):
    return np.array([[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)] for h in hs])


def smooth_noise(w, h, cells, seed):
    r = np.random.default_rng(seed).random((max(2, h // cells + 2), max(2, w // cells + 2)))
    im = Image.fromarray((r * 255).astype(np.uint8)).resize((w + 2 * cells, h + 2 * cells), Image.BICUBIC)
    return np.asarray(im).astype(float)[cells:cells + h, cells:cells + w] / 255


def quantize(v, ramp):
    idx = np.clip((v * len(ramp)).astype(int), 0, len(ramp) - 1)
    return ramp[idx]


def rim(w, h, strength=.18, width=2):
    y, x = np.mgrid[0:h, 0:w]
    d = np.minimum.reduce([x, y, w - 1 - x, h - 1 - y]).astype(float)
    return np.clip(1 - d / width, 0, 1) * strength


# ------------------------------------------------------------------ palettes
STONE = hexramp('#34333a', '#46444b', '#58555b', '#6c686c', '#817c7d', '#97918f', '#aca59f')
DEEP = hexramp('#17161c', '#211f27', '#2c2a33', '#38353f', '#46424c', '#56515a')
MOSS = hexramp('#2f4a1c', '#3f6324', '#517d2c', '#679a37')
ROBE = hexramp('#24140c', '#331d11', '#442816', '#57331c', '#6b4023', '#804e2b')
GOLD = hexramp('#6b4a0e', '#946a12', '#bf8e17', '#e2b425', '#f7d750', '#fff08f')
LEATHER = hexramp('#22160f', '#311f14', '#43291a', '#563521')
BONE = hexramp('#5d564a', '#81796a', '#a59d8b', '#c9c1ad', '#e6dfcb')
IRON = hexramp('#3e4046', '#5a5d64', '#7a7d84', '#9da0a6', '#c2c4c8')
# Phase 2: everything glowing yellow
GSTONE = hexramp('#5a3c05', '#7d5508', '#a2700e', '#c78f17', '#e6ae23', '#f7c93a', '#ffe46a')
GDEEP = hexramp('#3a2604', '#523606', '#6d4909', '#8a5e0e', '#a87515', '#c48c1e')
GROBE = hexramp('#3b2306', '#523109', '#6b410c', '#845210', '#9c6315', '#b4761b')
GLOW = hexramp('#fff3a6', '#fffad0', '#ffffff')
# Spark God: molten white-gold
OSTONE = hexramp('#b98a16', '#d4a51f', '#ebc12f', '#f7d74c', '#fde77a', '#fff3a8', '#fffbd8')


def stone_slabs(w, h, ramp, seed, moss=True, glow=None):
    n = smooth_noise(w, h, 6, seed) * .5 + smooth_noise(w, h, 3, seed + 1) * .2
    y = np.mgrid[0:h, 0:w][0]
    v = .28 + n * .55 + (1 - y / h) * .18
    v -= rim(w, h, .22, 2)
    out = quantize(v, ramp)
    # mortar seams: dark line with a highlight under it (bevelled slabs)
    r = np.random.default_rng(seed)
    row = 0
    seams = []
    while row < h - 6:
        row += int(r.integers(10, 15))
        if row >= h - 3:
            break
        seams.append(row)
        out[row, 1:w - 1] = ramp[0]
        out[row + 1, 1:w - 1] = ramp[min(len(ramp) - 1, 4)]
    # vertical joints, offset per course
    bounds = [0] + seams + [h]
    for i in range(len(bounds) - 1):
        jx = int(r.integers(6, w - 6))
        out[bounds[i] + 2:bounds[i + 1], jx] = ramp[0]
        out[bounds[i] + 2:bounds[i + 1], jx + 1] = ramp[3]
    if glow is not None:
        # glowing seams and a crack network for the phase-2 skin
        for s in seams:
            out[s, 1:w - 1] = glow[0]
        crack(out, seed + 7, glow, count=5)
    elif moss:
        m = smooth_noise(w, h, 4, seed + 3)
        y = np.mgrid[0:h, 0:w][0]
        mask = (m + (y / h) ** 2 * .9) > 1.05
        mv = quantize(np.clip(m * 1.2 - .1, 0, .999), MOSS)
        out[mask] = mv[mask]
    return out


def crack(out, seed, glow, count=3):
    h, w = out.shape[:2]
    r = np.random.default_rng(seed)
    for _ in range(count):
        x, y = int(r.integers(4, w - 4)), int(r.integers(2, h // 3))
        for _ in range(int(r.integers(18, 34))):
            out[y, x] = glow[1]
            if 0 < x < w - 1:
                out[y, x - 1] = glow[0] * .92 + out[y, x - 1] * .08
            y += 1
            x += int(r.integers(-1, 2))
            x = int(np.clip(x, 2, w - 3))
            if y >= h - 2:
                break


def robe(w, h, ramp, trim, seed, glow=False):
    y, x = np.mgrid[0:h, 0:w]
    folds = np.sin(x / w * np.pi * 4 + np.sin(y / 9) * .4) * .5 + .5
    v = .25 + folds * .35 + smooth_noise(w, h, 5, seed) * .25 - rim(w, h, .15, 2)
    out = quantize(v, ramp)
    tb = 3
    gold = quantize(np.clip(.45 + (1 - (y % 8) / 8) * .4 + smooth_noise(w, h, 3, seed + 1) * .15, 0, .999), trim)
    band = (y < tb) | (y >= h - tb)
    out[band] = gold[band]
    out[tb, :] = trim[0]
    out[h - tb - 1, :] = trim[0]
    # stitched seam inside each trim
    if glow:
        out[((y == tb + 2) | (y == h - tb - 3)) & (x % 4 == 0)] = GLOW[1]
    # a few hanging threads / rune marks
    if glow:
        out[(x % 8 == 3) & (y > tb + 4) & (y < h - tb - 4) & ((y // 3) % 3 == 0)] = GLOW[0]
    return out


def chain(w, h, ramp, glow=False):
    y, x = np.mgrid[0:h, 0:w]
    v = .55 + .35 * np.cos((x / w - .5) * np.pi) - .25 * ((y % 8) < 2)
    out = quantize(np.clip(v, 0, .999), ramp)
    out[(y % 8) == 0] = ramp[0]
    if glow:
        out[((y % 8) == 4) & (np.abs(x - w // 2) < 4)] = GLOW[2]
    return out


def leather(w, h, ramp, stud, seed):
    y, x = np.mgrid[0:h, 0:w]
    v = .3 + smooth_noise(w, h, 4, seed) * .45 - rim(w, h, .2, 2)
    out = quantize(np.clip(v, 0, .999), ramp)
    for cy in range(6, h, 12):
        for cx in (6, w - 7):
            out[cy - 1:cy + 2, cx - 1:cx + 2] = stud[3]
            out[cy - 1, cx - 1] = stud[5]
            out[cy + 1, cx + 1] = stud[1]
    return out


def skull(w, h, ramp, eye, seed):
    """Skull drawn for a cube face ~3.5 x 4.5 units (texels are ~1.4x taller than wide in model space)."""
    y, x = np.mgrid[0:h, 0:w]
    v = .55 + smooth_noise(w, h, 4, seed) * .25 + (1 - y / h) * .15 - rim(w, h, .3, 3)
    out = quantize(np.clip(v, 0, .999), ramp)
    dark = np.array([.1, .08, .07])
    # eye sockets
    for cx in (8, 23):
        m = ((x - cx) / 6.0) ** 2 + ((y - 24) / 9.0) ** 2 < 1
        out[m] = dark
        g = ((x - cx) / 2.2) ** 2 + ((y - 25) / 3.2) ** 2 < 1
        out[g] = eye
    # nose
    m = (np.abs(x - 15.5) < (y - 34) * .45 + .5) & (y >= 34) & (y < 41)
    out[m] = dark
    # teeth
    tm = (y >= 47) & (y < 57) & (x > 4) & (x < w - 5)
    out[tm] = ramp[4]
    out[tm & ((x - 5) % 4 == 0)] = dark
    out[(y == 52) & (x > 4) & (x < w - 5)] = dark
    return out


def plaque(w, h, base, sym, seed):
    out = stone_slabs(w, h, base, seed, moss=False)
    pts = [(10, 1), (5, 8), (9, 8), (6, 14), (12, 6), (8, 6)]  # lightning bolt
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        for t in np.linspace(0, 1, 16):
            out[int(round(y0 + (y1 - y0) * t)), int(round(x0 + (x1 - x0) * t))] = sym
    return out


def iron_plate(w, h, ramp, seed):
    y, x = np.mgrid[0:h, 0:w]
    v = .35 + (1 - (x + y) / (w + h)) * .4 + smooth_noise(w, h, 4, seed) * .15 - rim(w, h, .3, 2)
    out = quantize(np.clip(v, 0, .999), ramp)
    for cx, cy in ((3, 3), (w - 4, 3), (3, h - 4), (w - 4, h - 4)):
        out[cy, cx] = ramp[-1]
        out[cy + 1, cx + 1] = ramp[0]
    return out


def paint(variant):
    old = np.asarray(Image.open(RP + 'bolt_titan.png').convert('RGBA')).astype(float) / 255
    img = np.zeros((128, 256, 4))
    glow = variant in ('phase2', 'god')
    S = {'phase1': STONE, 'phase2': GSTONE, 'god': OSTONE}[variant]
    D = {'phase1': DEEP, 'phase2': GDEEP, 'god': GSTONE}[variant]
    Rb = {'phase1': ROBE, 'phase2': GROBE, 'god': GSTONE}[variant]
    G = GOLD if not glow else hexramp('#f2c94a', '#fbe07a', '#fff0a8', '#fff8d2', '#ffffff', '#ffffff') if variant == 'god' else hexramp('#c08a12', '#e0ab1c', '#f5cb33', '#ffe266', '#fff19c', '#ffffff')
    gl = GLOW if glow else None

    def put(x, y, tile):
        h, w = tile.shape[:2]
        img[y:y + h, x:x + w, :3] = tile
        img[y:y + h, x:x + w, 3] = 1

    put(0, 0, stone_slabs(32, 64, S, 1, glow=gl))           # face, arms, fists
    put(32, 0, stone_slabs(32, 64, D, 2, moss=not glow, glow=gl))  # legs, horns, boulders
    put(64, 0, robe(32, 64, Rb, G, 3, glow))                 # robe, hood, shoulder cloth
    put(96, 0, leather(32, 64, LEATHER if not glow else D, G, 4))  # belt bits
    put(128, 0, skull(32, 64, BONE if not glow else S, (1, .93, .45) if not glow else (1, 1, 1), 5))
    put(224, 0, chain(32, 64, G, glow))                       # chest chains
    if glow:
        dec = quantize(np.clip(.3 + smooth_noise(16, 16, 4, 6) * .5 - rim(16, 16, .2, 2), 0, .999), D)
        dec[8, 3:13] = GLOW[0]
        dec[7, 6] = dec[9, 10] = GLOW[1]
    else:
        dec = quantize(np.clip(.3 + smooth_noise(16, 16, 4, 6) * .5 - rim(16, 16, .2, 2), 0, .999), STONE)
        m = smooth_noise(16, 16, 3, 16) > .45
        dec[m] = quantize(np.clip(smooth_noise(16, 16, 2, 26), 0, .999), MOSS)[m]
    put(0, 64, dec)
    put(32, 64, robe(16, 16, Rb, G, 7, glow))
    put(128, 64, plaque(16, 16, IRON if not glow else D, G[4] if not glow else GLOW[2], 8))
    put(160, 64, leather(16, 16, LEATHER if not glow else D, G, 9))
    put(224, 96, quantize(np.clip(.5 + smooth_noise(16, 16, 4, 10) * .4, 0, .999), BONE if not glow else G))
    # keep the original glowing eyes
    img[80:96, 224:240] = old[80:96, 224:240]
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    p1 = paint('phase1')
    paint('phase2').save(RP + 'bolt_titan_low.png')
    paint('god').save(RP + 'bolt_titan_god.png')
    p1.save(RP + 'bolt_titan.png')
    print('painted')
