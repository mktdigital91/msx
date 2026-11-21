# Mixa narração + trilha + efeitos a partir do timeline.json do render.py
# Uso: python3 mix.py AUDIO_DIR TIMELINE OUT_WAV
import sys, os, json, subprocess
import numpy as np
AUD, TL, OUTW = sys.argv[1:4]
SR = 44100
tl = json.load(open(TL)); T0, D, total = tl['T0'], tl['D'], tl['total']
N = int((total + 0.3) * SR)

def load(f, ch=2):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', f, '-f', 's16le', '-ac', str(ch), '-ar', str(SR), '-'])
    return np.frombuffer(raw, np.int16).astype(np.float32).reshape(-1, ch) / 32768

rng = np.random.default_rng(7)
def whoosh(d=0.55):
    n = int(d * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n)
    # ruído filtrado com frequência que sobe e desce (filtro passa-banda simples de 2 polos)
    fc = 300 + 2600 * np.sin(np.pi * t / d) ** 2
    y = np.zeros(n); y1 = y2 = 0.0; q = 2.2
    for i in range(n):
        w0 = 2 * np.pi * fc[i] / SR; al = np.sin(w0) / (2 * q); c = np.cos(w0)
        b0 = al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al
        yi = (b0 * x[i] - b0 * (x[i - 2] if i > 1 else 0) - a1 * y1 - a2 * y2) / a0
        y2, y1 = y1, yi; y[i] = yi
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.6
    y = y * env; y /= np.abs(y).max()
    pan = np.linspace(-0.6, 0.6, n)
    return np.stack([y * (1 - pan) / 1.6, y * (1 + pan) / 1.6], 1) * 0.55
def click():
    n = int(0.06 * SR); t = np.arange(n) / SR
    y = (np.sin(2 * np.pi * 2300 * t) * 0.6 + rng.standard_normal(n) * 0.4) * np.exp(-t / 0.008)
    y2 = np.sin(2 * np.pi * 900 * t) * np.exp(-t / 0.02) * 0.5
    y = (y + y2); y /= np.abs(y).max()
    return np.stack([y, y], 1) * 0.5
def key():
    c = click(); return c[: int(0.03 * SR)] * 0.35
def ding():
    n = int(1.4 * SR); t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / dcy) for f, a, dcy in [(1568, 1, .55), (2349, .5, .35), (3136, .3, .25), (784, .25, .6)])
    y *= np.minimum(1, t / 0.004); y /= np.abs(y).max()
    return np.stack([y, y], 1) * 0.42
SFX = {'whoosh': whoosh(), 'click': click(), 'key': key(), 'ding': ding()}

out = np.zeros((N, 2), np.float32)
def add(buf, x, t, g=1.0):
    i = int(t * SR)
    if i < 0: x = x[-i:]; i = 0
    j = min(N, i + len(x)); buf[i:j] += x[: j - i] * g

# narração
voice = np.zeros((N, 2), np.float32)
for k in range(11):
    f = os.path.join(AUD, 'n%02d.wav' % (k + 1))
    if os.path.exists(f):
        v = load(f); v = v / max(1e-6, np.abs(v).max()) * 0.89
        add(voice, v, T0[k] + tl['nar_off'])
# efeitos
fx = np.zeros((N, 2), np.float32)
for kind, t in tl['events']: add(fx, SFX[kind], t)
# trilha: a do vídeo do Gold Play, estendida com emenda suave
m = load(os.path.join(AUD, 'musica.mp3'))
while len(m) < N:
    xf = int(2.0 * SR); tail = m[-xf:]; head = m[int(6 * SR): int(6 * SR) + xf]
    r = np.linspace(0, 1, xf)[:, None]
    m = np.concatenate([m[:-xf], tail * (1 - r) + head * r, m[int(6 * SR) + xf:]])
m = m[:N] / max(1e-6, np.abs(m).max())
t = np.arange(N) / SR
lv = np.full(N, 0.15, np.float32)
lv[t < T0[1]] = 0.42                         # sobe na abertura
lv = np.where((t >= T0[1]) & (t < T0[1] + 0.6), 0.42 + (0.15 - 0.42) * (t - T0[1]) / 0.6, lv)
st = T0[10] + 0.1 + (os.path.exists(os.path.join(AUD, 'n11.wav')) and 0 or 0)
lv = np.where(t >= T0[10] + 0.2, 0.22, lv)    # final: sobe sob a última fala
endv = T0[10] + D[10] - 1.6
lv = np.where(t >= endv, 0.22 + 0.25 * np.clip((t - endv) / 0.5, 0, 1), lv)
lv *= np.clip((total + 0.25 - t) / 1.2, 0, 1)  # fade final
# leve ducking extra quando há voz
env = np.convolve(np.abs(voice[:, 0]), np.ones(2205) / 2205, mode='same')
duck = 1 - 0.25 * np.clip(env / 0.05, 0, 1)
mix = voice + fx * 0.9 + m * (lv * duck)[:, None]
mix /= max(1.0, np.abs(mix).max() / 0.97)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-i', '-', OUTW], input=mix.astype(np.float32).tobytes(), check=True)
print('mix ok', N / SR)
