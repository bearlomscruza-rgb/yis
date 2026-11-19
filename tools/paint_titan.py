"""Paints the Bolt Titan skins (V220).

python3 tools/paint_titan.py
Writes textures/entity/bolt_titan.png (phase 1), bolt_titan_low.png (phase 2+: glowing yellow)
and bolt_titan_god.png (Spark God) into SparkMod_V244_Resources.

The model maps one rectangle ("patch") of the texture onto every face of a cube, so each patch
is painted as a self-contained, low-noise pixel-art tile with a darker rim (cube edges read clearly)
and colors quantized to a short Minecraft-style shade ramp.
"""
import numpy as np
from PIL import Image

RP = 'SparkMod_V244_Resources/textures/entity/'
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


def stone_slabs(w, h, ramp, seed, moss=True, glow=None, seam_glow=True, crack_count=0, crack_len=0):
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
        if seam_glow:
            for s in seams:
                out[s, 1:w - 1] = glow[0]
        if crack_count:
            out = cracks_from_top(out, seed + 7, crack_count, crack_len)
    elif moss:
        m = smooth_noise(w, h, 4, seed + 3)
        y = np.mgrid[0:h, 0:w][0]
        mask = (m + (y / h) ** 2 * .9) > 1.05
        mv = quantize(np.clip(m * 1.2 - .1, 0, .999), MOSS)
        out[mask] = mv[mask]
    return out


def crack_paths(mask, x, y, ang, length, rng, aspect=1.0, width=1.0, depth=0):
    """Branching random-walk crack drawn into a float mask (1 = crack core)."""
    h, w = mask.shape
    for i in range(int(length)):
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < w and 0 <= yi < h):
            return
        mask[yi, xi] = max(mask[yi, xi], width)
        if width > .8 and xi + 1 < w:
            mask[yi, xi + 1] = max(mask[yi, xi + 1], width * .8)
        ang += rng.normal(0, .35)
        x += np.cos(ang)
        y += np.sin(ang) * aspect
        if depth < 2 and rng.random() < .07 and length - i > 6:
            crack_paths(mask, x, y, ang + rng.choice([-1, 1]) * rng.uniform(.6, 1.1), (length - i) * .55,
                        rng, aspect, width * .75, depth + 1)
        width = max(.45, width * .985)


def blur(m, n=2):
    for _ in range(n):
        p = np.pad(m, 1, mode='edge')
        m = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + p[1:-1, 1:-1] * 2) / 6
    return m


def apply_glow(out, mask, hot=(1, 1, .86), mid=(1, .87, .25), halo=.5):
    """Composite cracks: white-hot core, yellow edge, soft yellow halo bleeding into the surface."""
    if mask.max() <= 0:
        return out
    soft = blur(mask, 2)
    soft = soft / max(soft.max(), 1e-6)
    out = out * (1 - soft[..., None] * halo) + np.array(mid) * soft[..., None] * halo
    core = mask >= .5
    edge = (blur((mask > 0).astype(float), 1) > .2) & ~core
    out[edge] = np.array(mid) * .9 + out[edge] * .1
    out[core] = hot
    return out


def cracks_from_top(out, seed, count, length, aspect=1.0):
    h, w = out.shape[:2]
    rng = np.random.default_rng(seed)
    mask = np.zeros((h, w))
    for k in range(count):
        x = (k + .5) / count * w + rng.uniform(-3, 3)
        crack_paths(mask, x, 0, np.pi / 2 + rng.uniform(-.5, .5), length, rng, aspect)
    return apply_glow(out, mask)


def chest_burst(out, stage, seed):
    """Cracks radiating from the heart of the chest; they reach further at each stage."""
    h, w = out.shape[:2]
    if stage <= 0:
        return out
    rng = np.random.default_rng(seed)
    mask = np.zeros((h, w))
    # chest face is 25.4 x 29 model units on 32 x 64 texels -> texels are ~1.75x shorter vertically
    aspect = (25.4 / 32) / (29 / 64)
    cx, cy = 12.6, 11.0
    reach = {1: 12, 2: 26, 3: 48}[stage]
    n = {1: 5, 2: 7, 3: 9}[stage]
    for k in range(n):
        ang = k / n * 2 * np.pi + rng.uniform(-.25, .25)
        crack_paths(mask, cx, cy, ang, reach * rng.uniform(.75, 1.15), rng, aspect, 1.0)
    out = apply_glow(out, mask, halo=.5)
    # glowing heart
    y, x = np.mgrid[0:h, 0:w]
    r = np.hypot((x - cx), (y - cy) / aspect)
    heart = np.clip(1 - r / (3 + stage * 1.5), 0, 1) ** .8
    out = out * (1 - heart[..., None]) + np.array([1, .97, .7]) * heart[..., None]
    out[r < 1.4] = (1, 1, 1)
    return out


def eye(variant):
    """Angry glowing eye, drawn for the +x eye (the -x eye uses a mirrored UV)."""
    e = np.zeros((16, 16, 3))
    y, x = np.mgrid[0:16, 0:16]
    e[:] = (.09, .06, .02)                                # dark socket
    top = 3 + x * .45                                     # slanted brow: high outside, low inside
    almond = (y > top) & (y < 13.5 - np.abs(x - 7.5) * .35)
    e[almond] = (1, .72, .08)
    inner = almond & (y > top + 2) & (y < 12 - np.abs(x - 7.5) * .45)
    e[inner] = (1, .9, .3)
    pupil = (np.abs(x - 7.5) < 1.6) & (y > top + 1.5) & (y < 12.5)
    e[pupil & almond] = (1, 1, .85)                       # white-hot slit
    e[(y <= top) & (y > top - 2)] = (.2, .13, .04)        # brow shadow
    if variant == 'phase1':
        e[almond] = e[almond] * .9 + np.array([.1, .05, 0])
    return e


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


def paint(variant, stage=0):
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

    # Cracks start at the chest (stage 1), spread down the arms, face and robe (stage 2),
    # then split the legs and horns too (stage 3).
    put(0, 0, stone_slabs(32, 64, S, 1, glow=gl, seam_glow=stage >= 2,
                          crack_count={0: 0, 1: 0, 2: 3, 3: 4}[stage], crack_len={2: 30, 3: 64}.get(stage, 0)))
    put(32, 0, stone_slabs(32, 64, D, 2, moss=not glow, glow=gl, seam_glow=stage >= 3,
                           crack_count=4 if stage >= 3 else 0, crack_len=60))
    rb = robe(32, 64, Rb, G, 3, glow)
    put(64, 0, cracks_from_top(rb, 33, 3, 34) if stage >= 2 else rb)  # robe, hood, shoulder cloth
    put(192, 0, chest_burst(robe(32, 64, Rb, G, 3, glow), stage, 44))  # chest front: cracks start here
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
    # Spark Core (chest_core bone, only shown once he cracks): white-hot heart the cracks start from
    y, x = np.mgrid[0:16, 0:16]
    r = np.hypot(x - 7.5, y - 7.5)
    core = np.zeros((16, 16, 3))
    core[:] = (.55, .32, .03)
    core[r < 7.2] = (.95, .62, .07)
    core[r < 5.4] = (1, .85, .2)
    core[r < 3.6] = (1, .97, .6)
    core[r < 2.0] = (1, 1, 1)
    core[((np.abs(x - 7.5) < .6) | (np.abs(y - 7.5) < .6)) & (r < 7)] = (1, 1, .9)
    core[(r >= 7.2)] *= .7
    img[96:112, 240:256, :3] = core
    img[96:112, 240:256, 3] = 1
    img[80:96, 224:240, :3] = eye(variant)
    img[80:96, 224:240, 3] = 1
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    paint('phase1', 0).save(RP + 'bolt_titan.png')
    paint('phase2', 1).save(RP + 'bolt_titan_low1.png')
    paint('phase2', 2).save(RP + 'bolt_titan_low2.png')
    paint('phase2', 3).save(RP + 'bolt_titan_low.png')
    paint('god', 3).save(RP + 'bolt_titan_god.png')
    print('painted')
