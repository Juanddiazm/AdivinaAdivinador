"""Genera los íconos del lanzador (PNG) en app/src/main/res. Requiere Pillow."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RES = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
S = 1024  # se dibuja grande y luego se reduce


def background(size):
    img = Image.new("RGBA", (size, size))
    top, bottom = (92, 46, 200), (36, 18, 84)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    return img


def foreground(size, scale):
    """Bola amarilla con un signo de interrogación; scale = fracción del lienzo que ocupa."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    r = size * scale / 2
    cx = cy = size / 2
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([cx - r, cy - r + size * 0.03, cx + r, cy + r + size * 0.03], fill=(0, 0, 0, 110))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(size * 0.02)))
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 204, 51, 255))
    d.ellipse([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], fill=(255, 214, 90, 255))
    font = ImageFont.truetype(FONT, int(r * 1.45))
    d.text((cx, cy + r * 0.04), "?", font=font, fill=(42, 22, 96, 255), anchor="mm")
    # destellos
    for (sx, sy, k) in [(0.80, 0.22, 1.0), (0.18, 0.74, 0.7)]:
        x, y, a = cx + (sx - 0.5) * size * scale * 1.15, cy + (sy - 0.5) * size * scale * 1.15, r * 0.16 * k
        d.polygon([(x, y - a), (x + a * 0.28, y - a * 0.28), (x + a, y), (x + a * 0.28, y + a * 0.28),
                   (x, y + a), (x - a * 0.28, y + a * 0.28), (x - a, y), (x - a * 0.28, y - a * 0.28)],
                  fill=(255, 255, 255, 255))
    return img


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


legacy = background(S)
legacy.alpha_composite(foreground(S, 0.70))
legacy = rounded(legacy, int(S * 0.22))
fg = foreground(S, 0.52)  # dentro de la zona segura de 66/108 dp

for name, k in DENSITIES.items():
    d = os.path.join(RES, "mipmap-" + name)
    os.makedirs(d, exist_ok=True)
    legacy.resize((int(48 * k),) * 2, Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
    fg.resize((int(108 * k),) * 2, Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"))
    background(int(108 * k)).save(os.path.join(d, "ic_launcher_background.png"))

legacy.resize((512, 512), Image.LANCZOS).save(os.path.join(RES, "..", "ic_launcher-playstore.png"))
print("íconos generados")
