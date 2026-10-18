# Gera msx/img/jogos.gif: cartão "Jogos de hoje" com os principais times passando, cada um na sua cor.
# Só nomes e cores (sem escudos, que são marcas registradas). O texto do cartão vai por cima, pelo app.
import numpy as np
from PIL import Image, ImageDraw, ImageFont
W, H = 600, 380
F = "/usr/share/fonts/opentype/inter/InterDisplay-"
TIMES = [("FLAMENGO", "#C8102E", "#111111"), ("PALMEIRAS", "#006437", "#0B3B22"), ("CORINTHIANS", "#1A1A1A", "#3A3A3A"),
         ("SÃO PAULO", "#E30613", "#111111"), ("FLUMINENSE", "#7A0026", "#00613C"), ("FORTALEZA", "#11519B", "#ED1C24"),
         ("GRÊMIO", "#0D80BF", "#111111"), ("INTERNACIONAL", "#E5050F", "#8A0008"), ("CRUZEIRO", "#2F529E", "#1B2F63"),
         ("VASCO", "#111111", "#2B2B2B"), ("BOTAFOGO", "#151515", "#3C3C3C"), ("BAHIA", "#006CB5", "#ED3237")]
hx = lambda c: tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
def painel(nome, c1, c2):
    # cores chapadas (sem degradê: no GIF degradê vira faixas)
    im = Image.new("RGB", (W, H), hx(c1)); d = ImageDraw.Draw(im)
    d.polygon([(W * 0.62, 0), (W, 0), (W, H), (W * 0.36, H)], fill=hx(c2))
    d.polygon([(W * 0.56, 0), (W * 0.60, 0), (W * 0.34, H), (W * 0.30, H)], fill=tuple(min(255, v + 40) for v in hx(c1)))
    escuro = Image.new("RGB", (W, H), (8, 8, 10)); m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rectangle([0, int(H * 0.5), W, H], fill=175)
    im.paste(escuro, (0, 0), m)
    d = ImageDraw.Draw(im)
    tam = 64 if len(nome) <= 9 else 50 if len(nome) <= 11 else 42
    f = ImageFont.truetype(F + "Black.otf", tam)
    d.text((W - 36, 46), nome, font=f, fill=(255, 255, 255), anchor="ra")
    d.rectangle([W - 96, 46 + tam + 16, W - 36, 46 + tam + 21], fill=(255, 255, 255))
    return im
quadros, tempos = [], []
ps = [painel(*t) for t in TIMES]
for i, p in enumerate(ps):
    q = ps[(i + 1) % len(ps)]
    quadros.append(p); tempos.append(1300)
    for k in range(1, 4):  # desliza o próximo da direita para a esquerda
        s = int(W * (1 - (1 - k / 4) ** 2))
        fr = p.copy(); fr.paste(q.crop((0, 0, s, H)), (W - s, 0)); quadros.append(fr); tempos.append(50)
pal = [f.quantize(32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in quadros]
pal[0].save("msx/img/jogos.gif", save_all=True, append_images=pal[1:], duration=tempos, loop=0, optimize=True)
print("ok", len(quadros))
