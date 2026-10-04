#!/usr/bin/env python3
"""Descarga imágenes libres de Wikimedia Commons para las categorías con fotos o logos.

Uso:
  tools/fetch_images.py resolve   # busca en Wikidata qué archivo usar para cada respuesta nueva
  tools/fetch_images.py build     # descarga, procesa y genera imagenes.json + creditos.html
  tools/fetch_images.py sheet     # hojas de contacto para revisar a ojo (en build/revision/)

La fuente de verdad es tools/imagenes-fuentes.json: por cada categoría y respuesta guarda el
archivo de Commons elegido y opciones (p. ej. "pixelar": true para logos que muestran el nombre).
Se puede editar a mano para cambiar una imagen y volver a correr `build`.
"""
import hashlib
import html
import io
import json
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "app/src/main/assets"
CATEGORIES = ASSETS / "data/categorias.json"
SOURCES = ROOT / "tools/imagenes-fuentes.json"
IMAGES_JSON = ASSETS / "data/imagenes.json"
IMG_DIR = ASSETS / "img"
CREDITS_HTML = ASSETS / "web/creditos.html"
CACHE = ROOT / "build/imagenes-cache"
REVIEW = ROOT / "build/revision"

UA = {"User-Agent": "AdivinaAdivinador/1.0 (https://github.com/Juanddiazm/AdivinaAdivinador)"}
WIKIDATA = "https://www.wikidata.org/w/api.php"
ESWIKI = "https://es.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"

PHOTO_CATEGORIES = ["lugares", "animales", "comidas", "personajes", "deportes"]
LOGO_CATEGORIES = ["marcas"]

PHOTO_MAX_SIDE = 560
LOGO_CANVAS = 480
LOGO_BOX = 380
# Bloques en el lado largo del logo para cada etapa: va de irreconocible a casi nítido.
PIXEL_LEVELS = [6, 10, 16, 26]
FREE_LICENSE = re.compile(r"public domain|^pd|^fal\b|apache|^mit\b|bsd|cc0|cc[ -]by|attribution|gfdl|free art|copyrighted free use", re.I)


def api(url, **params):
    query = urllib.parse.urlencode({**params, "format": "json"})
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{url}?{query}", headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def load_sources():
    return json.loads(SOURCES.read_text(encoding="utf-8")) if SOURCES.exists() else {}


def save_sources(sources):
    SOURCES.write_text(json.dumps(sources, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def answers_by_category():
    data = json.loads(CATEGORIES.read_text(encoding="utf-8"))
    # En "scramble" la respuesta es el único elemento; en el resto va después de la pista.
    base = lambda c: 0 if c["type"] == "scramble" else 1
    return {c["id"]: [item[base(c)] for item in c["items"]] for c in data["categories"]}


# ---------------------------------------------------------------- resolve

def qid_for_title(title):
    """Wikidata id del artículo de Wikipedia en español (siguiendo redirecciones)."""
    pages = api(ESWIKI, action="query", titles=title, redirects=1, prop="pageprops")["query"]["pages"]
    page = next(iter(pages.values()))
    props = page.get("pageprops", {})
    if "disambiguation" in props:
        return None, "desambiguación"
    return props.get("wikibase_item"), page.get("title")


def claim_files(qid, prop):
    claims = api(WIKIDATA, action="wbgetentities", ids=qid, props="claims")["entities"][qid]["claims"]
    return [c["mainsnak"].get("datavalue", {}).get("value") for c in claims.get(prop, []) if c["mainsnak"].get("datavalue")]


def resolve(category, answer, entry):
    """Completa entry["archivo"] usando el artículo (entry["wiki"]) o el propio nombre."""
    if entry.get("archivo"):
        return entry
    title = entry.get("wiki", answer)
    qid, info = qid_for_title(title)
    if not qid:
        entry["pendiente"] = f"sin artículo claro para '{title}' ({info})"
        return entry
    props = ["P8972", "P154"] if category in LOGO_CATEGORIES else ["P18"]
    for prop in props:
        files = claim_files(qid, prop)
        if files:
            entry["archivo"] = files[0]
            entry.pop("pendiente", None)
            return entry
    entry["pendiente"] = f"{qid} ({info}) no tiene {'/'.join(props)}"
    return entry


def cmd_resolve():
    sources = load_sources()
    answers = answers_by_category()
    for category in PHOTO_CATEGORIES + LOGO_CATEGORIES:
        group = sources.setdefault(category, {})
        for answer in answers[category]:
            entry = group.setdefault(answer, {})
            resolve(category, answer, entry)
            status = entry.get("archivo") or f"PENDIENTE: {entry.get('pendiente')}"
            print(f"{category:10} {answer:28} {status}")
        save_sources(sources)


# ---------------------------------------------------------------- build

def file_info(filename):
    pages = api(COMMONS, action="query", titles=f"File:{filename}", prop="imageinfo",
                iiprop="url|extmetadata", iiurlwidth=800)["query"]["pages"]
    page = next(iter(pages.values()))
    if "imageinfo" not in page:
        raise ValueError(f"No existe en Commons: {filename}")
    info = page["imageinfo"][0]
    meta = info.get("extmetadata", {})
    text = lambda key: html.unescape(re.sub(r"<[^>]+>", "", meta.get(key, {}).get("value", ""))).strip()
    return {
        "thumb": info.get("thumburl") or info["url"],
        "page": info["descriptionurl"],
        "license": text("LicenseShortName") or "Ver página",
        "license_url": meta.get("LicenseUrl", {}).get("value", ""),
        "author": re.sub(r"\s+", " ", text("Artist"))[:120] or "Desconocido",
    }


def download(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / hashlib.sha1(url.encode()).hexdigest()
    if not cached.exists():
        req = urllib.request.Request(url, headers=UA)
        cached.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        time.sleep(0.3)
    return Image.open(io.BytesIO(cached.read_bytes()))


def process_photo(image):
    image = image.convert("RGB")
    image.thumbnail((PHOTO_MAX_SIDE, PHOTO_MAX_SIDE), Image.LANCZOS)
    return image


def process_logo(image):
    """Logo centrado sobre fondo blanco (muchos logos son negros y no se verían en el tema oscuro)."""
    flat = Image.new("RGBA", image.size, "white")
    flat.alpha_composite(image.convert("RGBA"))
    flat = flat.convert("RGB")
    # Algunos archivos traen mucho margen blanco: se recorta para que el logo se vea grande.
    box = trim_box(flat)
    if box:
        flat = flat.crop(box)
    flat.thumbnail((LOGO_BOX, LOGO_BOX), Image.LANCZOS)
    canvas = Image.new("RGB", (LOGO_CANVAS, LOGO_CANVAS), "white")
    canvas.paste(flat, ((LOGO_CANVAS - flat.width) // 2, (LOGO_CANVAS - flat.height) // 2))
    return canvas


def trim_box(image):
    """Caja que contiene todo lo que no es (casi) blanco."""
    inverted = Image.eval(image.convert("L"), lambda v: 255 - v)
    return inverted.point(lambda v: 255 if v > 12 else 0).getbbox()


def pixelate(image, blocks):
    """Pixela solo la zona del logo (no el margen blanco) con `blocks` cuadros en el lado largo."""
    box = trim_box(image) or (0, 0, image.width, image.height)
    logo = image.crop(box)
    scale = blocks / max(logo.size)
    grid = (max(1, round(logo.width * scale)), max(1, round(logo.height * scale)))
    blocky = logo.resize(grid, Image.BOX).resize(logo.size, Image.NEAREST)
    result = image.copy()
    result.paste(blocky, box[:2])
    return result


def save_webp(image, token, quality):
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    image.save(IMG_DIR / f"{token}.webp", "WEBP", quality=quality, method=6)


def cmd_build():
    sources = load_sources()
    answers = answers_by_category()
    previous = json.loads(IMAGES_JSON.read_text(encoding="utf-8")) if IMAGES_JSON.exists() else {}
    images, credits, used = {}, [], set()
    for category in PHOTO_CATEGORIES + LOGO_CATEGORIES:
        is_logo = category in LOGO_CATEGORIES
        for answer in answers[category]:
            entry = sources.get(category, {}).get(answer, {})
            if not entry.get("archivo") or entry.get("omitir"):
                continue
            info = file_info(entry["archivo"])
            if not FREE_LICENSE.search(info["license"]):
                print(f"!! licencia no libre, se omite: {category}/{answer}: {info['license']}")
                continue
            image = download(info["thumb"])
            processed = process_logo(image) if is_logo else process_photo(image)
            # Nombres al azar (y estables entre builds) para que la URL no delate la respuesta.
            old = previous.get(category, {}).get(answer, {})
            token = old.get("img") or secrets.token_hex(6)
            save_webp(processed, token, 85 if is_logo else 72)
            record = {"img": token}
            used.add(token)
            if entry.get("pixelar"):
                # Cada etapa con su propio nombre: no se puede adivinar la siguiente desde la anterior.
                old_pix = old.get("pix") if isinstance(old.get("pix"), list) else []
                pix = [old_pix[i] if i < len(old_pix) else secrets.token_hex(6) for i in range(len(PIXEL_LEVELS))]
                for blocks, name in zip(PIXEL_LEVELS, pix):
                    save_webp(pixelate(processed, blocks), name, 90)
                record["pix"] = pix
                used.update(pix)
            images.setdefault(category, {})[answer] = record
            credits.append({"category": category, "token": token, "file": entry["archivo"], **info})
            print(f"ok {category:10} {answer:28} {info['license']}")
    for stale in IMG_DIR.glob("*.webp"):
        if stale.stem not in used:
            stale.unlink()
    IMAGES_JSON.write_text(json.dumps(images, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_credits(credits)
    total = sum(f.stat().st_size for f in IMG_DIR.glob("*.webp"))
    print(f"\n{len(used)} imágenes, {total / 1024 / 1024:.1f} MB")


def write_credits(credits):
    names = {c["id"]: c["name"] for c in json.loads(CATEGORIES.read_text(encoding="utf-8"))["categories"]}
    rows = []
    for c in credits:
        license_html = html.escape(c["license"])
        if c["license_url"]:
            license_html = f'<a href="{html.escape(c["license_url"])}">{license_html}</a>'
        rows.append(
            f'<li><span class="cat">{html.escape(names.get(c["category"], c["category"]))}</span> '
            f'<a href="{html.escape(c["page"])}">{html.escape(c["file"])}</a> · '
            f'{html.escape(c["author"])} · {license_html}</li>'
        )
    CREDITS_HTML.write_text(f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Créditos de imágenes</title>
<style>
 body {{ font-family: system-ui, sans-serif; background: #15102b; color: #eee; margin: 0; padding: 16px; line-height: 1.45; }}
 h1 {{ font-size: 22px; }} a {{ color: #ffd166; word-break: break-word; }}
 li {{ margin: 0 0 10px; font-size: 14px; }} .cat {{ color: #b9a8ff; font-weight: 700; }}
 p {{ color: #c9c2e6; font-size: 14px; }}
</style></head><body>
<h1>📷 Créditos de imágenes</h1>
<p>Las fotos y logos vienen de <a href="https://commons.wikimedia.org">Wikimedia Commons</a> y se usan
según su licencia. Se redujeron de tamaño; los logos se centraron sobre fondo blanco y algunos se
muestran pixelados durante la pregunta. Las marcas pertenecen a sus dueños y se muestran solo para el juego.</p>
<ul>
{chr(10).join(rows)}
</ul>
</body></html>
""", encoding="utf-8")


# ---------------------------------------------------------------- sheet

def cmd_sheet():
    images = json.loads(IMAGES_JSON.read_text(encoding="utf-8"))
    REVIEW.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default()
    cell, label = 200, 28
    for category, items in images.items():
        entries = list(items.items())
        for page in range(0, len(entries), 20):
            chunk = entries[page:page + 20]
            cols = 5
            rows = (len(chunk) + cols - 1) // cols
            sheet = Image.new("RGB", (cols * cell, rows * (cell + label)), "#222")
            draw = ImageDraw.Draw(sheet)
            for i, (answer, rec) in enumerate(chunk):
                token = rec["pix"][0] if "pix" in rec else rec["img"]
                im = Image.open(IMG_DIR / f"{token}.webp").convert("RGB")
                im.thumbnail((cell - 8, cell - 8))
                x, y = (i % cols) * cell, (i // cols) * (cell + label)
                sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
                draw.text((x + 4, y + cell + 6), f"{answer}{' [pix]' if 'pix' in rec else ''}"[:30], fill="white", font=font)
            sheet.save(REVIEW / f"{category}-{page // 20 + 1}.png")
    print(f"Hojas en {REVIEW}")


if __name__ == "__main__":
    {"resolve": cmd_resolve, "build": cmd_build, "sheet": cmd_sheet}[sys.argv[1] if len(sys.argv) > 1 else "build"]()
