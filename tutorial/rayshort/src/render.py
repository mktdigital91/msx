# Renderiza o vídeo vertical "Como instalar o RayShort na Smart TV".
# Uso: python3 render.py ASSETS AUDIO OUT_DIR [--preview]
import sys, os, math, subprocess, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

A, AUD, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
PREVIEW = '--preview' in sys.argv
W, H, FPS = 1080, 1920, 30
BG = (9, 8, 12); PANEL = (18, 16, 23); PINK = (255, 79, 120); TXT = (247, 243, 238); GRAY = (170, 164, 181)
FD = '/usr/share/fonts/opentype/inter/'
def font(w, s): return ImageFont.truetype(FD + 'Inter-%s.otf' % w, s)

# ---------------- áudio: narração e duração de cada cena ----------------
def dur(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
SPEC = [4, 6, 5, 4, 4, 7, 5, 7, 8, 6, 5]
EST = {4: 1.6, 7: 3.2, 9: 7.6, 11: 5.0}  # estimativa enquanto a fala não existe
NAR_OFF = 0.12
speech = []
for i in range(1, 12):
    f = os.path.join(AUD, 'n%02d.wav' % i)
    speech.append(dur(f) if os.path.exists(f) else EST[i])
D = [max(SPEC[i], speech[i] + NAR_OFF + 0.35) for i in range(11)]
T0 = [sum(D[:i]) for i in range(11)]
TOTAL = sum(D)
NF = int(round(TOTAL * FPS))

# ---------------- helpers ----------------
def ease(x): x = min(1, max(0, x)); return 1 - (1 - x) ** 3
def ease_back(x):
    x = min(1, max(0, x)); c1 = 1.70158; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
def text_img(txt, f, color, maxw=None, lh=None, align='left'):
    lines = []
    if maxw:
        for para in txt.split('\n'):
            cur = ''
            for w_ in para.split(' '):
                t = (cur + ' ' + w_).strip()
                if f.getlength(t) <= maxw or not cur: cur = t
                else: lines.append(cur); cur = w_
            lines.append(cur)
    else:
        lines = txt.split('\n')
    asc, desc = f.getmetrics(); lh = lh or (asc + desc)
    wmax = int(max(f.getlength(l) for l in lines)) + 8
    im = Image.new('RGBA', (wmax, lh * (len(lines) - 1) + asc + desc + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k, l in enumerate(lines):
        x = 0 if align == 'left' else (wmax - f.getlength(l)) / 2
        if isinstance(color, list): c = color[k]
        else: c = color
        d.text((x, k * lh), l, font=f, fill=c)
    return im
def paste_anim(fr, im, x, y, t, delay, dy=46, dur_=0.5):
    p = ease((t - delay) / dur_)
    if p <= 0: return
    a = im if p >= 1 else Image.fromarray((np.asarray(im).astype(np.float32) * np.array([1, 1, 1, p])).astype(np.uint8))
    fr.alpha_composite(a, (int(x), int(y + (1 - p) * dy)))

# fundo com brilho rosa suave
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
g1 = np.exp(-(((xx - 160) / 700) ** 2 + ((yy - 120) / 620) ** 2)) * 0.10
g2 = np.exp(-(((xx - 1000) / 800) ** 2 + ((yy - 1900) / 520) ** 2)) * 0.05
bgarr = np.array(BG, np.float32)[None, None] * (1 - g1 - g2)[..., None] + np.array(PINK, np.float32)[None, None] * (g1 + g2)[..., None] * 0.55
BGIMG = Image.fromarray(np.clip(bgarr, 0, 255).astype(np.uint8)).convert('RGBA')

LOGO = Image.open(os.path.join(A, 'logo.png')).convert('RGBA')
def logo(sz): return LOGO.resize((sz, sz), Image.LANCZOS)
LOGO_S = logo(96)
F_FOOT_L = font('SemiBold', 32); F_FOOT_R = font('Bold', 34)
FOOT_L = text_img('RayShort', F_FOOT_L, GRAY)
FOOT_R = text_img('tv.rayshort.live', F_FOOT_R, PINK)
NSTEPS = 8

# moldura de TV
TVX0, TVY0, TVX1, TVY1 = 32, 430, 1048, 1018
SX0, SY0, SW, SH = TVX0 + 6, TVY0 + 6, (TVX1 - TVX0) - 12, (TVY1 - TVY0) - 12  # 1004 x 576
FRAME = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(FRAME)
d.rounded_rectangle((TVX0 - 4, TVY0 - 4, TVX1 + 4, TVY1 + 4), 30, fill=(0, 0, 0, 120))
d.rounded_rectangle((TVX0, TVY0, TVX1, TVY1), 26, fill=(4, 4, 6, 255), outline=(52, 47, 62, 255), width=2)
d.rounded_rectangle((W // 2 - 110, TVY1 + 2, W // 2 + 110, TVY1 + 12), 4, fill=(36, 33, 44, 255))
SMASK = Image.new('L', (SW, SH), 0); ImageDraw.Draw(SMASK).rounded_rectangle((0, 0, SW - 1, SH - 1), 18, fill=255)

# ---------------- telas (espaço canônico 2*SW x 2*SH) ----------------
CW, CH = SW * 2, SH * 2
_cache = {}
def canon(name):
    if name in _cache: return _cache[name]
    im = Image.open(os.path.join(A, name + '.png')).convert('RGB')
    s = max(CW / im.width, CH / im.height)
    im = im.resize((int(math.ceil(im.width * s)), int(math.ceil(im.height * s))), Image.LANCZOS)
    ox, oy = (im.width - CW) / 2, (im.height - CH) / 2
    im = im.crop((int(ox), int(oy), int(ox) + CW, int(oy) + CH))
    _cache[name] = (im, s, ox, oy)
    return _cache[name]
def pt(name, x, y):  # coordenada da imagem original -> espaço de saída (SW x SH)
    im, s, ox, oy = canon(name)
    return ((x * s - ox) / 2, (y * s - oy) / 2)

# cada "plano": (início relativo, imagem, destaque (x,y,rx,ry) no espaço original ou None, clique)
def photo(n): return n  # fotos já estão em 1004x574
SC = [
    dict(kind='open'),
    dict(kind='step', n=1, title='Instale o Media Station X', line='Na loja de aplicativos da TV, procure Media Station X e aperte Abrir.',
         shots=[(0, 'p1', (231, 176, 92, 46), True)]),
    dict(kind='step', n=2, title='Abra o Start Parameter', line='No menu, vá em Settings e escolha Start Parameter.',
         shots=[(0, 'p2', (588, 222, 104, 84), True)]),
    dict(kind='step', n=3, title='Aperte Setup', line='Ele fica no rodapé da janela.',
         shots=[(0, 'p3', (384, 468, 120, 48), True)]),
    dict(kind='step', n=4, title='Aceite o aviso', line='Escolha Continue.',
         shots=[(0, 'p4', (402, 464, 122, 48), True)]),
    dict(kind='step', n=5, title='Digite tv.rayshort.live', line='Use o teclado da tela e confirme no ✓.', typing=True,
         shots=[(0, 'kb0', None, False)] + [(0.45 + k * 0.2, 'kb%02d' % (k + 1), None, False) for k in range(16)] + [(4.2, 'kbok', (1500, 922, 100, 52), True)]),
    dict(kind='step', n=6, title='Confirme com Sim', line='Vai aparecer a logo da RayShort. É só confirmar.',
         shots=[(0, 'complete', (672, 922, 160, 52), True)], zoomto=(840, 360)),
    dict(kind='ready', n=6, title='Pronto!', line='Os primeiros episódios de cada drama são grátis.',
         shots=[(0, 'inicio', None, False), (2.2, 'grade1', None, False), (3.7, 'grade2', None, False), (5.2, 'grade3', None, False)]),
    dict(kind='step', n=7, title='Entre ou crie sua conta', line='Use seu WhatsApp e senha. Para criar a conta, peça o código da TV ao seu revendedor.',
         shots=[(0, 'login1', (150, 596, 92, 46), True), (4.0, 'cadastro1', (480, 375, 470, 62), True)]),
    dict(kind='step', n=8, title='Ative o VIP com Pix', line='Escolha o plano e pague com o QR code. A liberação é automática.',
         shots=[(0, 'vip1', (699, 585, 150, 130), True), (1.8, 'pix1', (430, 500, 330, 330), False), (2.7, 'pix2', (430, 500, 330, 330), False),
                (3.6, 'pix3', (430, 500, 330, 330), False), (4.5, 'pixok', (1185, 603, 380, 60), 'ding')]),
    dict(kind='close'),
]
# o "Pronto!" do Pix fica no fim da cena 10: ajusta para o fim real
# (o ding toca quando aparece "Pagamento confirmado")

# ---------------- desenho dos elementos fixos ----------------
def draw_top(fr, t, stepn, sc_t):
    fr.alpha_composite(LOGO_S, (90, 96))
    x1 = 990; dw, gap = 40, 10; x0 = x1 - (NSTEPS * dw + (NSTEPS - 1) * gap)
    d = ImageDraw.Draw(fr)
    for k in range(NSTEPS):
        x = x0 + k * (dw + gap); y = 140
        d.rounded_rectangle((x, y, x + dw, y + 8), 4, fill=(44, 40, 52, 255))
        if k + 1 < stepn: d.rounded_rectangle((x, y, x + dw, y + 8), 4, fill=PINK + (255,))
        elif k + 1 == stepn:
            p = ease(sc_t / 0.6); ww = max(8, dw * p)
            d.rounded_rectangle((x, y, x + ww, y + 8), 4, fill=PINK + (255,))
def draw_foot(fr):
    d = ImageDraw.Draw(fr)
    d.line((90, 1722, 990, 1722), fill=(38, 35, 46, 255), width=2)
    fr.alpha_composite(FOOT_L, (90, 1760))
    fr.alpha_composite(FOOT_R, (990 - FOOT_R.width + 8, 1758))

F_BADGE = font('Bold', 30); F_TITLE = font('Bold', 74); F_LINE = font('Regular', 40)
def badge_img(n):
    t = 'PASSO %d' % n; tw = F_BADGE.getlength(t)
    im = Image.new('RGBA', (int(tw) + 48, 60), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, 59), 30, fill=PINK + (255,))
    d.text((24, 12), t, font=F_BADGE, fill=BG + (255,)); return im
for sc in SC:
    if sc['kind'] in ('step', 'ready'):
        sc['badge'] = badge_img(sc['n']) if sc['kind'] == 'step' else None
        tcolor = TXT
        title = sc['title']
        sc['timg'] = text_img(title, F_TITLE, tcolor, maxw=900, lh=86)
        sc['limg'] = text_img(sc['line'], F_LINE, GRAY, maxw=900, lh=56)

def ring_layer(cx, cy, rx, ry, t_since):
    # círculo de destaque pulsando (coordenadas na saída)
    pad = 120
    L = Image.new('RGBA', (int(2 * rx + 2 * pad), int(2 * ry + 2 * pad)), (0, 0, 0, 0))
    d = ImageDraw.Draw(L); c = (L.width / 2, L.height / 2)
    pop = ease_back(t_since / 0.35); s = 1.5 - 0.5 * pop
    a = min(1, t_since / 0.15)
    def ell(sc_, w, al, fill=None):
        d.ellipse((c[0] - rx * sc_, c[1] - ry * sc_, c[0] + rx * sc_, c[1] + ry * sc_), outline=PINK + (int(255 * al),), width=w, fill=fill)
    ell(s, 7, a, fill=PINK + (int(34 * a),))
    ph = (t_since % 1.1) / 1.1
    if t_since > 0.3: ell(s * (1 + 0.35 * ease(ph)), 4, a * (1 - ph) * 0.9)
    glow = L.filter(ImageFilter.GaussianBlur(9))
    out = Image.alpha_composite(glow, L)
    return out, (cx - L.width / 2, cy - L.height / 2)

def screen_at(sc, t):
    shots = sc['shots']; idx = 0
    for k, s in enumerate(shots):
        if t >= s[0]: idx = k
    st, name, hl, click = shots[idx]
    im, *_ = canon(name)
    local = t - st
    # Ken Burns: aproxima devagar em direção ao destaque
    if hl: fx, fy = pt(name, hl[0], hl[1])
    elif sc.get('zoomto'): fx, fy = sc['zoomto']
    else: fx, fy = SW / 2, SH / 2
    if sc.get('typing') and idx < len(shots) - 1:
        fx, fy = SW / 2, SH * 0.3; local = t
    span = D[SC.index(sc)]
    z = 1 + 0.07 * ease(min(1, local / max(1.5, span - st)))
    cw, ch = SW / z, SH / z
    k = (z - 1) / 0.07 if z > 1 else 0
    cx = SW / 2 + (fx - SW / 2) * 0.9 * k; cy = SH / 2 + (fy - SH / 2) * 0.9 * k
    x0 = min(max(cx - cw / 2, 0), SW - cw); y0 = min(max(cy - ch / 2, 0), SH - ch)
    img = im.resize((SW, SH), Image.BILINEAR, box=(x0 * 2, y0 * 2, (x0 + cw) * 2, (y0 + ch) * 2))
    # transição entre planos da mesma cena
    if idx > 0 and local < 0.22 and not (sc.get('typing') and idx < len(shots) - 1):
        pst, pname, phl, _ = shots[idx - 1]
        pim, *_ = canon(pname)
        prev = pim.resize((SW, SH), Image.BILINEAR, box=(x0 * 2, y0 * 2, (x0 + cw) * 2, (y0 + ch) * 2))
        img = Image.blend(prev, img, ease(local / 0.22))
    ring = None
    if hl:
        hx, hy = pt(name, hl[0], hl[1]); _, s_, _, _ = canon(name)
        rx, ry = hl[2] * s_ / 2 * z, hl[3] * s_ / 2 * z
        tc = st + (0.55 if st == 0 else 0.3)
        if t >= tc:
            ring = ring_layer((hx - x0) * z, (hy - y0) * z, rx, ry, t - tc)
    return img, ring

def frame_step(sc, t, i):
    fr = BGIMG.copy()
    draw_top(fr, t, sc['n'], t)
    # TV entra deslizando
    p = ease(t / 0.55)
    off = int((1 - p) * 60)
    img, ring = screen_at(sc, t)
    tv = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    tv.alpha_composite(FRAME)
    scr = img.convert('RGBA'); scr.putalpha(SMASK)
    tv.alpha_composite(scr, (SX0, SY0))
    if ring:
        rl, (rx0, ry0) = ring
        # recorta o anel dentro da tela
        tmp = Image.new('RGBA', (SW, SH), (0, 0, 0, 0)); tmp.alpha_composite(rl, (int(rx0), int(ry0))) if rx0 >= 0 and ry0 >= 0 else tmp.paste(rl, (int(rx0), int(ry0)), rl)
        m = Image.fromarray(np.minimum(np.asarray(tmp.getchannel('A')), np.asarray(SMASK)))
        tmp.putalpha(m); tv.alpha_composite(tmp, (SX0, SY0))
    if p < 1:
        a = np.asarray(tv).copy(); a[..., 3] = (a[..., 3] * p).astype(np.uint8); tv = Image.fromarray(a)
    fr.alpha_composite(tv, (0, off))
    y = 1086
    if sc['badge'] is not None:
        paste_anim(fr, sc['badge'], 90, y, t, 0.18); y += 92
    else:
        y += 10
    paste_anim(fr, sc['timg'], 86, y, t, 0.28); y += sc['timg'].height + 18
    paste_anim(fr, sc['limg'], 90, y, t, 0.40)
    draw_foot(fr)
    return fr

F_OT = font('ExtraBold', 82); F_OS = font('Medium', 40)
OPEN_T = text_img('Como instalar\no RayShort\nna sua Smart TV', F_OT, [TXT, PINK, TXT], lh=98, align='center')
OPEN_S = text_img('Leva menos de 2 minutos', F_OS, GRAY, align='center')
LOGO_BIG = logo(320)
def glow_disc(r, al):
    g = Image.new('RGBA', (r * 4, r * 4), (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse((r, r, 3 * r, 3 * r), fill=PINK + (al,))
    return g.filter(ImageFilter.GaussianBlur(r * 0.45))
GLOW = glow_disc(200, 70)
def frame_open(t):
    fr = BGIMG.copy()
    pulse = 1 + 0.04 * math.sin(t * 2.6)
    g = GLOW.resize((int(GLOW.width * pulse), int(GLOW.height * pulse)))
    fr.alpha_composite(g, (W // 2 - g.width // 2, 560 - g.height // 2))
    p = ease_back(t / 0.7); a = ease(t / 0.4)
    sz = max(2, int(320 * (0.7 + 0.3 * p)))
    li = LOGO_BIG.resize((sz, sz), Image.LANCZOS)
    if a < 1:
        arr = np.asarray(li).copy(); arr[..., 3] = (arr[..., 3] * a).astype(np.uint8); li = Image.fromarray(arr)
    fr.alpha_composite(li, (W // 2 - sz // 2, 560 - sz // 2))
    paste_anim(fr, OPEN_T, W // 2 - OPEN_T.width // 2, 820, t, 0.45, dy=60, dur_=0.6)
    paste_anim(fr, OPEN_S, W // 2 - OPEN_S.width // 2, 1160, t, 0.9)
    draw_foot(fr)
    return fr

LOGO_C = logo(260)
CL_A = text_img('No Media Station X, digite', font('Medium', 46), GRAY, align='center')
CL_C = text_img('e aproveite a RayShort.', font('Medium', 46), GRAY, align='center')
def pill():
    f = font('ExtraBold', 76); t = 'tv.rayshort.live'; tw = f.getlength(t)
    im = Image.new('RGBA', (int(tw) + 120, 150), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((3, 3, im.width - 4, im.height - 4), 72, fill=(28, 14, 22, 255), outline=PINK + (255,), width=5)
    d.text((60, 28), t, font=f, fill=PINK + (255,)); return im
PILL = pill()
def frame_close(t):
    fr = BGIMG.copy()
    fr.alpha_composite(GLOW, (W // 2 - GLOW.width // 2, 560 - GLOW.height // 2))
    p = ease_back(t / 0.6); sz = max(2, int(260 * (0.75 + 0.25 * p)))
    li = LOGO_C.resize((sz, sz), Image.LANCZOS)
    fr.alpha_composite(li, (W // 2 - sz // 2, 560 - sz // 2))
    paste_anim(fr, CL_A, W // 2 - CL_A.width // 2, 840, t, 0.25)
    pp = ease_back((t - 0.5) / 0.5) if t > 0.5 else 0
    if pp > 0:
        pulse = 1 + 0.025 * math.sin(max(0, t - 1.0) * 4) if t > 1 else 1
        s = max(0.01, (0.6 + 0.4 * pp) * pulse)
        im = PILL.resize((int(PILL.width * s), int(PILL.height * s)), Image.LANCZOS)
        if pp < 1:
            arr = np.asarray(im).copy(); arr[..., 3] = (arr[..., 3] * min(1, pp)).astype(np.uint8); im = Image.fromarray(arr)
        fr.alpha_composite(im, (W // 2 - im.width // 2, 1000 - im.height // 2))
    paste_anim(fr, CL_C, W // 2 - CL_C.width // 2, 1120, t, 1.0)
    draw_foot(fr)
    return fr

def render(i):
    t = i / FPS
    s = max(k for k in range(11) if T0[k] <= t + 1e-9)
    lt = t - T0[s]; sc = SC[s]
    if sc['kind'] == 'open': fr = frame_open(lt)
    elif sc['kind'] == 'close': fr = frame_close(lt)
    else: fr = frame_step(sc, lt, i)
    # transição: escurece no fim e clareia no começo (com whoosh)
    a = 1.0
    if s > 0: a = min(a, ease(lt / 0.28))
    if s < 10: a = min(a, (D[s] - lt) / 0.2)
    if s == 10: a = min(a, (D[s] - lt) / 0.6)
    a = max(0, min(1, a))
    out = fr.convert('RGB')
    if a < 1: out = Image.blend(BGIMG.convert('RGB'), out, a)
    return out

# ---------------- eventos de som ----------------
def events():
    ev = []
    for s in range(1, 11): ev.append(('whoosh', T0[s] - 0.22))
    for s, sc in enumerate(SC):
        if sc['kind'] in ('step', 'ready'):
            for st, name, hl, click in sc['shots']:
                if hl and click:
                    tc = st + (0.55 if st == 0 else 0.3)
                    ev.append(('ding' if click == 'ding' else 'click', T0[s] + tc))
            if sc['kind'] == 'ready': ev.append(('ding', T0[s] + 0.25))
            if sc.get('typing'):
                for k in range(16): ev.append(('key', T0[s] + 0.45 + k * 0.2))
    return ev

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    json.dump(dict(D=D, T0=T0, total=TOTAL, nar_off=NAR_OFF, events=events()), open(os.path.join(OUT, 'timeline.json'), 'w'), indent=1)
    if PREVIEW:
        ts = [float(x) for x in sys.argv[sys.argv.index('--preview') + 1].split(',')]
        for t in ts: render(int(t * FPS)).save(os.path.join(OUT, 'prev_%05.1f.png' % t))
        sys.exit()
    if '--cover' in sys.argv:
        render(int(1.6 * FPS)).save(os.path.join(OUT, 'capa.png')); sys.exit()
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', os.path.join(OUT, 'video.mp4')], stdin=subprocess.PIPE)
    for i in range(NF):
        p.stdin.write(render(i).tobytes())
        if i % 150 == 0: print(i, '/', NF, flush=True)
    p.stdin.close(); p.wait()
    print('ok', TOTAL)
