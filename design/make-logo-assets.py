"""Builds the web app's logo assets from design/express-cash-train-logo.png.

- train.webp: the train banner with its white background made transparent (sign-in screen)
- icon.png, icon-192.png, apple-touch-icon.png, favicon.ico: a simple "EC" mark,
  because the wide banner is unreadable at icon size
The header wordmark is live text in CSS (.wordmark), so it stays sharp at any size.

Run: python3 design/make-logo-assets.py   (needs Pillow and numpy)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = "design/express-cash-train-logo.png"
OUT = "apps/web/public"
FONT = "/usr/share/fonts/opentype/inter/Inter-BlackItalic.otf"
NAVY = (4, 18, 52)

# ---- Banner: remove only the white background around the train.
src = Image.open(SRC).convert("RGB")
rgb = np.asarray(src).astype(np.float32)
light = (rgb.min(axis=2) > 120).astype(np.uint8) * 255
# Flood-fill the light area that touches the edges, so white text and highlights
# inside the train stay solid.
region = Image.fromarray(light, "L").copy()
w, h = region.size
for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
    if region.getpixel(seed) == 255:
        ImageDraw.floodfill(region, seed, 128)
bg = (np.asarray(region) == 128)
# Soften the boundary a little so edges do not look cut out.
soft = np.asarray(Image.fromarray(bg.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255

# Colour-to-alpha against white: glows keep their colour and fade to transparent.
alpha_c2a = np.clip((255 - rgb).max(axis=2) / 255, 0, 1)
alpha = np.where(soft > 0, (1 - soft) + soft * alpha_c2a, 1.0)
safe = np.maximum(alpha, 1e-3)[..., None]
unmixed = np.clip(255 - (255 - rgb) / np.where(soft[..., None] > 0, safe, 1), 0, 255)
color = np.where(soft[..., None] > 0, unmixed, rgb)
rgba = np.dstack([color, alpha * 255]).astype(np.uint8)
full = Image.fromarray(rgba, "RGBA")
banner = full.crop(full.getbbox())
banner.thumbnail((1400, 1400), Image.LANCZOS)
banner.save(f"{OUT}/train.webp", quality=88)


# ---- Icon: the train's front car with "Express Cash!" on deep navy, as the user cropped it,
# with a small "SHAJAL SPEAKS" underneath on the larger sizes only (unreadable below ~120 px).
FRONT = (860, 95, 2172, 555)  # front car and its rail glow, in the original banner's pixels
front = full.crop(FRONT)
front = front.crop(front.getbbox())
# Fade out the bottom so the rail glow does not end in a hard line.
fade = np.ones(front.height, np.float32)
n = int(front.height * 0.16)
fade[-n:] = np.linspace(1, 0, n)
fa = np.asarray(front).astype(np.float32)
fa[..., 3] *= fade[:, None]
front = Image.fromarray(fa.astype(np.uint8), "RGBA")


def icon(size):
    s = 4 * size
    im = Image.new("RGBA", (s, s), NAVY + (255,))
    glow = Image.new("L", (s, s), 0)
    ImageDraw.Draw(glow).ellipse((int(s * 0.1), int(s * 0.15), int(s * 1.1), int(s * 0.85)), fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.14))
    im = Image.composite(Image.new("RGBA", (s, s), (16, 70, 170, 255)), im, glow)
    with_text = size >= 120
    w = int(s * 1.0)  # full width: "Express" at the left edge, the nose at the right
    h = int(front.height * w / front.width)
    y = (s - h) // 2 - (int(s * 0.05) if with_text else 0)
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    big = front.resize((w, h), Image.LANCZOS)
    layer.paste(big, (0, y), big)
    im.alpha_composite(layer)
    if with_text:
        d = ImageDraw.Draw(im)
        font = ImageFont.truetype(FONT, int(s * 0.05))
        text = "SHAJAL SPEAKS"
        tw = d.textlength(text, font=font)
        ty = y + h - int(s * 0.01)
        d.text(((s - tw) / 2, ty), text, font=font, fill=(200, 230, 255, 220))
    return im.convert("RGB").resize((size, size), Image.LANCZOS)


icon(512).save(f"{OUT}/icon.png", optimize=True)
icon(192).save(f"{OUT}/icon-192.png", optimize=True)
icon(180).save(f"{OUT}/apple-touch-icon.png", optimize=True)
icon(64).convert("RGBA").save("apps/web/src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("banner", banner.size)
