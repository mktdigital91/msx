# Gera as imagens do tema "Ônix" (preto com dourado) em msx/img/temas/onix/.
# Uso: python3 tools/tema_onix.py   (precisa de Pillow e numpy; fonte Inter)
import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAIZ = os.path.join(os.path.dirname(__file__), "..", "msx", "img", "temas", "onix")
os.makedirs(RAIZ, exist_ok=True)
F = "/usr/share/fonts/opentype/inter/"
def fonte(peso, tam): return ImageFont.truetype(F + f"InterDisplay-{peso}.otf", tam)

OURO = (214, 178, 94)        # dourado principal
OURO_CLARO = (240, 214, 150)
OURO_ESCURO = (150, 112, 48)
CINZA = (168, 162, 152)      # texto secundário quente
S = 3                        # supersampling

def gradiente(w, h, c1, c2, ang=135):
    a = math.radians(ang)
    x = np.linspace(0, 1, w)[None, :]; y = np.linspace(0, 1, h)[:, None]
    t = (x * math.cos(a) + y * math.sin(a)); t = (t - t.min()) / (t.max() - t.min())
    c1 = np.array(c1 + (255,) if len(c1) == 3 else c1, float); c2 = np.array(c2 + (255,) if len(c2) == 3 else c2, float)
    arr = c1[None, None, :] * (1 - t[..., None]) + c2[None, None, :] * t[..., None]
    return Image.fromarray(arr.astype(np.uint8), "RGBA")

def brilho(w, h, cx, cy, r, cor, forca):
    y, x = np.mgrid[0:h, 0:w]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
    a = np.clip(1 - d, 0, 1) ** 2.2 * forca
    arr = np.zeros((h, w, 4), np.uint8); arr[..., 0], arr[..., 1], arr[..., 2] = cor
    arr[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")

def ruido(w, h, forca=6):
    n = (np.random.default_rng(7).normal(0, forca, (h, w))).clip(-20, 20)
    arr = np.zeros((h, w, 4), np.uint8); v = (128 + n).astype(np.uint8)
    arr[..., 0] = arr[..., 1] = arr[..., 2] = v; arr[..., 3] = 14
    return Image.fromarray(arr, "RGBA")

# ---------- fundos 1920x1080 ----------
def fundo(nome, cor_brilho, cor2):
    w, h = 1920, 1080
    im = gradiente(w, h, (14, 13, 16), (6, 6, 8), 120)
    im.alpha_composite(brilho(w, h, 260, -120, 1250, cor_brilho, 0.30))
    im.alpha_composite(brilho(w, h, 1800, 1150, 1000, cor2, 0.14))
    # faixa de luz diagonal bem suave
    faixa = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(faixa)
    d.polygon([(900, 0), (1180, 0), (520, h), (240, h)], fill=cor_brilho + (16,))
    im.alpha_composite(faixa.filter(ImageFilter.GaussianBlur(90)))
    # vinheta
    y, x = np.mgrid[0:h, 0:w]
    v = np.clip((np.sqrt(((x - w / 2) / (w / 1.3)) ** 2 + ((y - h / 2) / (h / 1.2)) ** 2) - 0.45) * 1.4, 0, 1) * 150
    vin = np.zeros((h, w, 4), np.uint8); vin[..., 3] = v.astype(np.uint8)
    im.alpha_composite(Image.fromarray(vin, "RGBA"))
    im.alpha_composite(ruido(w, h))
    im.convert("RGB").save(os.path.join(RAIZ, nome), quality=90)

# ---------- ícones de linha (desenhados em escala grande) ----------
def icone(d, tipo, x, y, t, cor, lw):
    """desenha um ícone de linha num quadrado t x t com canto em (x, y)"""
    u = t / 24.0
    P = lambda a, b: (x + a * u, y + b * u)
    L = lambda pts: d.line([P(*p) for p in pts], fill=cor, width=lw, joint="curve")
    R = lambda a, b, c, e, r: d.rounded_rectangle([P(a, b), P(c, e)], radius=r * u, outline=cor, width=lw)
    if tipo == "tv":
        R(2, 6, 22, 20, 2.5); L([(8, 2), (12, 6), (16, 2)]); d.polygon([P(10, 10), P(10, 16), P(15.5, 13)], outline=cor, width=lw)
    elif tipo == "filme":
        R(2, 9, 22, 21, 2); R(2, 3.5, 22, 9, 1.5)
        for k in (7, 12, 17): L([(k, 3.5), (k - 2.5, 9)])
    elif tipo == "series":
        R(6, 2, 22, 18, 2.5); L([(2, 6), (2, 22), (18, 22)]); d.polygon([P(12, 6.5), P(12, 13.5), P(17, 10)], outline=cor, width=lw)
    elif tipo == "celular":
        R(6, 1.5, 18, 22.5, 2.5); L([(10.5, 4.5), (13.5, 4.5)]); d.ellipse([P(11.2, 18.2), P(12.8, 19.8)], fill=cor)
    elif tipo == "atualizar":
        d.arc([P(4, 4), P(20, 20)], start=-60, end=250, fill=cor, width=lw); L([(17, 2.5), (18.6, 6.4), (14.6, 7.6)])
    elif tipo == "pesquisar":
        d.ellipse([P(3, 3), P(16, 16)], outline=cor, width=lw); L([(14.5, 14.5), (21, 21)])
    elif tipo == "temas":
        d.ellipse([P(2.5, 2.5), P(21.5, 21.5)], outline=cor, width=lw)
        for (a, b) in ((8, 8), (15, 7.5), (17.5, 13), (7, 14.5)): d.ellipse([P(a - 1.6, b - 1.6), P(a + 1.6, b + 1.6)], fill=cor)
    elif tipo == "sair":
        L([(14, 3), (20, 3), (20, 21), (14, 21)]); L([(3, 12), (14, 12)]); L([(10, 8), (14, 12), (10, 16)])

def borda_dourada(w, h, r, lw, alfa=255):
    """moldura com gradiente dourado"""
    g = gradiente(w, h, OURO_CLARO + (alfa,), OURO_ESCURO + (alfa,), 120)
    m = Image.new("L", (w, h), 0); dm = ImageDraw.Draw(m)
    dm.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    dm.rounded_rectangle([lw, lw, w - 1 - lw, h - 1 - lw], radius=max(1, r - lw), fill=0)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0)); out.paste(g, (0, 0), m); return out

def vidro(w, h, r, topo=(26, 25, 30, 236), base=(12, 12, 15, 240)):
    g = gradiente(w, h, topo, base, 100)
    m = Image.new("L", (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0)); out.paste(g, (0, 0), m); return out

def reduz(im, w, h): return im.resize((w, h), Image.LANCZOS)

# ---------- cartões da tela inicial 660x480 ----------
def cartao(nome, tipo, titulo, sub, tom):
    W, H = 660 * S, 480 * S
    m = 14 * S                       # margem para a sombra
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sombra = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).rounded_rectangle([m, m + 8 * S, W - m, H - m + 4 * S], radius=34 * S, fill=(0, 0, 0, 150))
    im.alpha_composite(sombra.filter(ImageFilter.GaussianBlur(10 * S)))
    cw, ch = W - 2 * m, H - 2 * m
    corpo = vidro(cw, ch, 32 * S)
    # brilho dourado discreto no canto
    corpo.alpha_composite(Image.composite(brilho(cw, ch, cw * 0.95, -ch * 0.1, cw * 0.75, tom, 0.30), Image.new("RGBA", (cw, ch), (0, 0, 0, 0)), corpo.split()[3]))
    corpo.alpha_composite(borda_dourada(cw, ch, 32 * S, 2 * S, 200))
    d = ImageDraw.Draw(corpo)
    # ícone grande ao fundo (traço dourado bem apagado)
    icone(d, tipo, cw - 250 * S, 34 * S, 210 * S, OURO + (46,), 7 * S)
    # selo com o ícone
    d.rounded_rectangle([34 * S, 34 * S, 112 * S, 112 * S], radius=22 * S, outline=OURO + (230,), width=2 * S, fill=(214, 178, 94, 22))
    icone(d, tipo, 52 * S, 52 * S, 42 * S, OURO_CLARO + (255,), 3 * S)
    # filete dourado + textos
    d.rounded_rectangle([36 * S, ch - 150 * S, 84 * S, ch - 145 * S], radius=3 * S, fill=OURO + (255,))
    d.text((34 * S, ch - 132 * S), titulo, font=fonte("Bold", 58 * S), fill=(248, 246, 240, 255))
    d.text((36 * S, ch - 58 * S), sub, font=fonte("Medium", 25 * S), fill=CINZA + (255,))
    im.alpha_composite(corpo, (m, m))
    reduz(im, 660, 480).save(os.path.join(RAIZ, nome))

# ---------- botões em pílula 390x165 ----------
def pilula(nome, tipo, texto):
    W, H = 390 * S, 165 * S
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    m = 14 * S; cw, ch = W - 2 * m, H - 2 * m - 6 * S
    corpo = vidro(cw, ch, ch // 2, (24, 23, 28, 230), (12, 12, 15, 235))
    corpo.alpha_composite(borda_dourada(cw, ch, ch // 2, 2 * S, 210))
    d = ImageDraw.Draw(corpo)
    f = fonte("SemiBold", 38 * S); tw = d.textlength(texto, font=f)
    t = 34 * S; gap = 18 * S; x0 = (cw - (t + gap + tw)) / 2
    icone(d, tipo, x0, (ch - t) / 2, t, OURO_CLARO + (255,), 3 * S)
    asc = f.getbbox("A")[1]; altura = f.getbbox("A")[3] - asc
    d.text((x0 + t + gap, (ch - altura) / 2 - asc), texto, font=f, fill=(246, 244, 238, 255))
    im.alpha_composite(corpo, (m, m))
    reduz(im, 390, 165).save(os.path.join(RAIZ, nome))

# ---------- peças da tela de login ----------
def peca(nome, w, h, r, tipo=None, claro=False, ouro=False):
    W, H = w * S, h * S; m = 12 * S; cw, ch = W - 2 * m, H - 2 * m
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sombra = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).rounded_rectangle([m, m + 6 * S, W - m, H - m + 4 * S], radius=r * S, fill=(0, 0, 0, 130))
    im.alpha_composite(sombra.filter(ImageFilter.GaussianBlur(8 * S)))
    if claro:      # cartão do QR code: marfim (o QR precisa de fundo claro)
        corpo = vidro(cw, ch, r * S, (252, 249, 241, 255), (238, 232, 218, 255))
    elif ouro:     # botão principal: dourado escuro (o texto branco do MSX fica legível)
        corpo = vidro(cw, ch, r * S, (196, 154, 64, 255), (122, 90, 34, 255))
        corpo.alpha_composite(borda_dourada(cw, ch, r * S, 2 * S, 255))
    else:
        corpo = vidro(cw, ch, r * S)
    corpo.alpha_composite(borda_dourada(cw, ch, r * S, 2 * S, 210 if not ouro else 255))
    if tipo:
        d = ImageDraw.Draw(corpo); t = min(cw, ch) * 0.42
        icone(d, tipo, cw - t - 40 * S, (ch - t) / 2, t, OURO + (60,), 6 * S)
    im.alpha_composite(corpo, (m, m))
    reduz(im, w, h).save(os.path.join(RAIZ, nome))

if __name__ == "__main__":
    fundo("bg-tv.jpg", (214, 178, 94), (120, 96, 50))
    fundo("bg-filmes.jpg", (205, 132, 72), (130, 70, 40))
    fundo("bg-series.jpg", (196, 186, 160), (90, 110, 110))
    cartao("card-tv.png", "tv", "TV ao vivo", "Canais por categoria", (214, 178, 94))
    cartao("card-filmes.png", "filme", "Filmes", "Catálogo completo", (205, 132, 72))
    cartao("card-series.png", "series", "Séries", "Temporadas e episódios", (196, 186, 160))
    pilula("btn-sair.png", "sair", "Sair")
    pilula("btn-atualizar.png", "atualizar", "Atualizar")
    pilula("btn-pesquisar.png", "pesquisar", "Pesquisar")
    pilula("btn-temas.png", "temas", "Temas")
    peca("login-qr.png", 742, 707, 40, claro=True)
    peca("login-codigo.png", 742, 471, 36, tipo="celular")
    peca("login-campo.png", 1237, 249, 30)
    peca("login-entrar.png", 792, 305, 150, ouro=True)
    peca("login-novo.png", 792, 319, 150)
    print("ok", sorted(os.listdir(RAIZ)))
