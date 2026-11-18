"""Synthesizes SparkMod's custom Bolt Titan sound effects.

Run from the repo root:  python3 tools/make_sfx.py
Writes .ogg files into SparkMod_V218_Resources/sounds/sparkmod/ (needs numpy + ffmpeg).
"""
import os, subprocess, sys, tempfile, wave
import numpy as np

SR = 44100
OUT = sys.argv[1] if len(sys.argv) > 1 else 'SparkMod_V218_Resources/sounds/sparkmod'


def t(sec):
    return np.arange(int(SR * sec)) / SR


def lowpass(x, cutoff):
    """One-pole lowpass; cutoff may be a scalar or per-sample array."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def osc(freq, kind='sin', phase0=0.0):
    freq = np.asarray(freq, dtype=float)
    ph = phase0 + np.cumsum(freq) / SR
    if kind == 'sin':
        return np.sin(2 * np.pi * ph)
    if kind == 'saw':
        return 2 * (ph % 1) - 1
    if kind == 'sqr':
        return np.sign(np.sin(2 * np.pi * ph))
    raise ValueError(kind)


def env(n, attack, release, shape=2.0):
    e = np.ones(n)
    a = int(SR * attack)
    r = int(SR * release)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r) ** shape
    return e


def crackle(n, density, rng, decay=0.004):
    """Random electric clicks: sparse impulses with tiny exponential tails."""
    x = np.zeros(n)
    density = np.broadcast_to(np.asarray(density, dtype=float), (n,))
    hits = rng.random(n) < density / SR
    idx = np.nonzero(hits)[0]
    tail = np.exp(-np.arange(int(SR * decay * 4)) / (SR * decay))
    for i in idx:
        seg = rng.uniform(-1, 1, len(tail)) * tail * rng.uniform(.3, 1)
        end = min(n, i + len(tail))
        x[i:end] += seg[:end - i]
    return x


def dist(x, drive):
    return np.tanh(x * drive) / np.tanh(drive)


def norm(x, peak=0.8):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def write(name, x):
    os.makedirs(OUT, exist_ok=True)
    x = norm(x)
    fade = int(SR * .005)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    pcm = (x * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    dst = os.path.join(OUT, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libvorbis', '-q:a', '5', dst], check=True)
    os.remove(tmp)
    print('wrote', dst)


def zap(seed):
    rng = np.random.default_rng(seed)
    tt = t(.38)
    n = len(tt)
    f = 3200 * np.exp(-tt * 9) + 500 + rng.uniform(-80, 80)
    tone = osc(f, 'saw') * np.exp(-tt * 10)
    buzz = osc(120 + 60 * rng.random(), 'sqr') * np.exp(-tt * 14) * .5
    cr = crackle(n, 2600 * np.exp(-tt * 6), rng)
    hiss = highpass(rng.uniform(-1, 1, n), 2500) * np.exp(-tt * 18) * .8
    return dist(tone * .6 + buzz + cr * 1.4 + hiss, 2.5) * env(n, .002, .08)


def charge(seed, sec=1.4):
    rng = np.random.default_rng(seed)
    tt = t(sec)
    n = len(tt)
    p = tt / sec
    f = 70 * (14 ** p)
    a = osc(f, 'saw') + osc(f * 1.505, 'saw') * .5 + osc(f * .5, 'sin') * .6
    trem = .65 + .35 * np.sin(2 * np.pi * (6 + 30 * p) * tt)
    cr = crackle(n, 200 + 3800 * p ** 2, rng)
    whine = osc(600 + 3000 * p ** 1.5, 'sin') * p ** 2 * .35
    x = lowpass(a, 400 + 6000 * p) * trem * (.2 + .8 * p) + cr * (.3 + p) + whine
    return dist(x, 1.8) * env(n, .03, .02)


def beam(seed):
    rng = np.random.default_rng(seed)
    tt = t(1.6)
    n = len(tt)
    boom = osc(60 * np.exp(-tt * 1.2) + 28, 'sin') * np.exp(-tt * 3.0) * 1.3
    noise = lowpass(rng.uniform(-1, 1, n), 900 * np.exp(-tt * 2) + 120) * np.exp(-tt * 2.6) * 2.2
    buzz = osc(110 + 8 * np.sin(2 * np.pi * 7 * tt), 'saw') + osc(221, 'saw') * .6
    buzz = lowpass(buzz, 2600 * np.exp(-tt * 1.6) + 200) * np.exp(-tt * 1.9) * .9
    cr = crackle(n, 3500 * np.exp(-tt * 2), rng) * 1.2
    zz = highpass(rng.uniform(-1, 1, n), 4000) * np.exp(-tt * 9) * .7
    return dist(boom + noise + buzz + cr + zz, 2.2) * env(n, .002, .4)


def slam(seed):
    rng = np.random.default_rng(seed)
    tt = t(1.8)
    n = len(tt)
    thump = osc(70 * np.exp(-tt * 6) + 30, 'sin') * np.exp(-tt * 3.5) * 1.6
    rumble = lowpass(rng.uniform(-1, 1, n), 260) * np.exp(-tt * 1.8) * 3.0
    debris = lowpass(crackle(n, 900 * np.exp(-tt * 2.5), rng, .01), 2500) * 2.2
    cr = crackle(n, 1600 * np.exp(-tt * 4), rng) * .7
    return dist(thump + rumble + debris + cr, 2.0) * env(n, .001, .5)


def roar(seed):
    rng = np.random.default_rng(seed)
    tt = t(2.6)
    n = len(tt)
    swell = np.interp(tt, [0, .25, 1.6, 2.6], [0, 1, .9, 0])
    vib = 1 + .04 * np.sin(2 * np.pi * 5.5 * tt) + .02 * rng.standard_normal(n).cumsum() / np.sqrt(np.arange(1, n + 1))
    base = 62 * vib * np.interp(tt, [0, .4, 2.6], [.85, 1.05, .8])
    v = sum(osc(base * d, 'saw') for d in (1, 1.007, .993, 2.01)) / 3
    form = lowpass(v, 700 + 500 * np.sin(2 * np.pi * 1.3 * tt) ** 2)
    growl = lowpass(rng.uniform(-1, 1, n), 500) * (.6 + .4 * np.sin(2 * np.pi * 23 * tt)) * 1.5
    zzt = osc(base * 8, 'sqr') * .12 * (np.sin(2 * np.pi * 11 * tt) > .2)
    cr = crackle(n, 1200, rng) * .6
    return dist((form * 1.4 + growl + zzt + cr) * swell, 3.0)


def cannon_fire(seed):
    rng = np.random.default_rng(seed)
    tt = t(.7)
    n = len(tt)
    whoosh = lowpass(rng.uniform(-1, 1, n), 300 + 5000 * np.exp(-tt * 6)) * np.exp(-tt * 4) * 1.8
    pop = osc(180 * np.exp(-tt * 20) + 60, 'sin') * np.exp(-tt * 12) * 1.4
    zing = osc(900 + 2500 * tt, 'sin') * np.exp(-tt * 5) * .35
    return dist(whoosh + pop + zing + crackle(n, 1500 * np.exp(-tt * 5), rng), 2) * env(n, .001, .15)


def impact(seed):
    rng = np.random.default_rng(seed)
    tt = t(1.0)
    n = len(tt)
    b = osc(90 * np.exp(-tt * 8) + 40, 'sin') * np.exp(-tt * 5) * 1.4
    nz = lowpass(rng.uniform(-1, 1, n), 1600 * np.exp(-tt * 4) + 150) * np.exp(-tt * 4) * 2
    return dist(b + nz + crackle(n, 2500 * np.exp(-tt * 6), rng) * 1.1, 2.2) * env(n, .001, .3)


def teleport(seed):
    rng = np.random.default_rng(seed)
    tt = t(.65)
    n = len(tt)
    up = osc(np.where(tt < .3, 150 * (40 ** (tt / .3)), 6000 * np.exp(-(tt - .3) * 9)), 'sin')
    phaser = .6 + .4 * np.sin(2 * np.pi * 34 * tt)
    hiss = highpass(rng.uniform(-1, 1, n), 3000) * np.interp(tt, [0, .3, .65], [0, .7, 0])
    return (up * phaser + hiss + crackle(n, 2500, rng) * .8) * env(n, .01, .12)


def shutdown(seed):
    rng = np.random.default_rng(seed)
    tt = t(3.0)
    n = len(tt)
    p = tt / 3.0
    f = 420 * (1 / 16) ** p
    a = osc(f, 'saw') + osc(f * 2.003, 'saw') * .4
    x = lowpass(a, 4000 * (1 - p) + 120) * (1 - p) ** 1.3
    stutter = np.where(np.sin(2 * np.pi * (3 + 9 * p) * tt) > -.2, 1, .25)
    sp = crackle(n, 1600 * (1 - p) ** 2, rng)
    clunk = np.zeros(n)
    k = int(SR * 2.55)
    tk = t(.45)
    clunk[k:k + len(tk)] = (osc(55 * np.exp(-tk * 4), 'sin') * np.exp(-tk * 9) * 1.2 + lowpass(rng.uniform(-1, 1, len(tk)), 400) * np.exp(-tk * 12))[:n - k]
    return dist(x * stutter + sp * .8 + clunk, 1.8) * env(n, .005, .05)


def reboot(seed):
    rng = np.random.default_rng(seed)
    tt = t(2.4)
    n = len(tt)
    p = np.clip(tt / 1.8, 0, 1)
    f = 40 * (35 ** p)
    rise = (osc(f, 'saw') + osc(f * 1.5, 'saw') * .5) * np.where(tt < 1.8, p ** 1.2, 0)
    rise = lowpass(rise, 200 + 7000 * p)
    beeps = osc(np.full(n, 1320.0), 'sqr') * (((tt * 6) % 1) < .18) * (tt < 1.8) * .18 * p
    k = int(SR * 1.8)
    tb = tt[k:] - 1.8
    boom = np.zeros(n)
    boom[k:] = osc(65 * np.exp(-tb * 4) + 30, 'sin') * np.exp(-tb * 4) * 1.8 + lowpass(rng.uniform(-1, 1, n - k), 1200) * np.exp(-tb * 5) * 2.4
    cr = crackle(n, 300 + 4000 * p, rng)
    return dist(rise + beeps + boom + cr, 2.2) * env(n, .02, .2)


def beep(seed):
    tt = t(.16)
    return osc(np.full(len(tt), 990.0), 'sqr') * .5 * env(len(tt), .003, .05) + osc(np.full(len(tt), 1980.0), 'sin') * .2


def possess(seed):
    rng = np.random.default_rng(seed)
    tt = t(3.2)
    n = len(tt)
    swell = np.interp(tt, [0, 2.6, 3.2], [0, 1, 0]) ** 1.5
    wob = 1 + .03 * np.sin(2 * np.pi * .7 * tt)
    pad = sum(osc(fr * wob * (1 + .25 * tt / 3.2), 'sin') for fr in (110, 164.8, 233.1, 311.1)) / 4
    whisper = lowpass(highpass(rng.uniform(-1, 1, n), 1500), 4000) * (.5 + .5 * np.sin(2 * np.pi * 3.3 * tt + np.sin(2 * np.pi * .9 * tt) * 3)) ** 2
    sub = osc(40 * wob, 'sin') * .6
    cr = crackle(n, 600 * swell + 50, rng) * .7
    return dist((pad * 1.2 + whisper * .9 + sub + cr) * swell, 1.6)


def explode_big(seed):
    rng = np.random.default_rng(seed)
    tt = t(4.0)
    n = len(tt)
    b = osc(48 * np.exp(-tt * 1.5) + 22, 'sin') * np.exp(-tt * 1.4) * 1.7
    nz = lowpass(rng.uniform(-1, 1, n), 2400 * np.exp(-tt * 2.2) + 90) * np.exp(-tt * 1.3) * 3.2
    tail = lowpass(crackle(n, 1400 * np.exp(-tt * 1.2), rng, .012), 3000) * 1.8
    zap_tail = crackle(n, 2500 * np.exp(-tt * 1.8), rng) * .8
    return dist(b + nz + tail + zap_tail, 2.6) * env(n, .001, 1.2)


def hum(seed):
    rng = np.random.default_rng(seed)
    tt = t(1.5)
    n = len(tt)
    h = osc(np.full(n, 60.0), 'saw') * .6 + osc(np.full(n, 120.0), 'sin') * .4 + osc(np.full(n, 180.0), 'sin') * .2
    h = lowpass(h, 900) * (.8 + .2 * np.sin(2 * np.pi * 2 * tt))
    return (h + crackle(n, 150, rng) * .5) * env(n, .15, .3)


def demon(seed):
    rng = np.random.default_rng(seed)
    tt = t(1.8)
    n = len(tt)
    f = 300 + 120 * np.sin(2 * np.pi * 1.6 * tt) + 60 * np.sin(2 * np.pi * 7 * tt)
    v = osc(f, 'sin') * .6 + osc(f * 1.5 + 4, 'sin') * .4 + osc(f * .5, 'saw') * .2
    breath = lowpass(rng.uniform(-1, 1, n), 1800) * .5
    return (v + breath + crackle(n, 300, rng) * .5) * env(n, .3, .6)


if __name__ == '__main__':
    for i in range(3):
        write(f'zap{i + 1}', zap(10 + i))
    for i in range(2):
        write(f'charge{i + 1}', charge(20 + i))
        write(f'beam{i + 1}', beam(30 + i))
        write(f'slam{i + 1}', slam(40 + i))
        write(f'impact{i + 1}', impact(60 + i))
    write('charge_long', charge(25, 2.0))
    write('roar', roar(50))
    write('cannon_fire', cannon_fire(70))
    write('teleport', teleport(80))
    write('shutdown', shutdown(90))
    write('reboot', reboot(100))
    write('beep', beep(0))
    write('possess', possess(110))
    write('explode_big', explode_big(120))
    write('hum', hum(130))
    write('demon', demon(140))
