# Gera msx/img/splash.gif: logo Gold Play com zoom suave e brilho dourado passando (960x540)
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
W, H, N = 960, 540, 28
logo = Image.open("msx/img/logo-goldplay.png").convert("RGBA")
logo.thumbnail((300, 280))
y, x = np.mgrid[0:H, 0:W]
d = np.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2) / 520
base = np.clip(1 - d, 0, 1) ** 2
fundo = np.stack([10 + 34 * base, 9 + 26 * base, 12 + 10 * base], -1).astype(np.uint8)
quadros = []
for i in range(N):
    t = i / (N - 1)
    im = Image.fromarray(fundo).convert("RGBA")
    e = 0.92 + 0.08 * min(1, t * 1.6)                    # zoom de entrada
    lg = logo.resize((int(logo.width * e), int(logo.height * e)), Image.LANCZOS)
    a = min(1, t * 2.2)                                   # aparece
    lg.putalpha(lg.split()[3].point(lambda v: int(v * a)))
    px, py = (W - lg.width) // 2, (H - lg.height) // 2 - 20
    im.alpha_composite(lg, (px, py))
    # brilho diagonal passando sobre a logo
    s = Image.new("L", lg.size, 0); dd = ImageDraw.Draw(s)
    cx = -lg.width * 0.4 + t * lg.width * 1.8
    dd.polygon([(cx, 0), (cx + 50, 0), (cx - 60, lg.height), (cx - 110, lg.height)], fill=150)
    s = s.filter(ImageFilter.GaussianBlur(14))
    m = Image.fromarray(np.minimum(np.array(s), np.array(lg.split()[3])))
    im.paste(Image.new("RGBA", lg.size, (255, 244, 210, 255)), (px, py), m)
    # barra de progresso fina
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle([W / 2 - 90, py + lg.height + 40, W / 2 + 90, py + lg.height + 44], 2, fill=(60, 52, 40, 255))
    dr.rounded_rectangle([W / 2 - 90, py + lg.height + 40, W / 2 - 90 + 180 * t, py + lg.height + 44], 2, fill=(214, 178, 94, 255))
    quadros.append(im.convert("RGB").quantize(128, method=Image.Quantize.MEDIANCUT))
quadros[0].save("msx/img/splash.gif", save_all=True, append_images=quadros[1:] + [quadros[-1]] * 1, duration=[60] * (N - 1) + [60, 1200], loop=0, optimize=True)
print("ok")
