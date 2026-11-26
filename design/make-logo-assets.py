"""Builds the web app's logo assets from design/express-cash-logo-original.png.

- badge.webp: the full round badge with a transparent outside (login, phone home)
- badge-sm.webp: small badge for the header, next to the text wordmark
- icon.png, icon-192.png, apple-touch-icon.png, favicon.ico: app and browser icons

Run: python3 design/make-logo-assets.py   (needs Pillow)
"""
from PIL import Image, ImageDraw

SRC = "design/express-cash-logo-original.png"
OUT = "apps/web/public"

src = Image.open(SRC).convert("RGBA")
size = src.width
# Round mask just outside the glowing ring, smoothed by drawing large then shrinking.
scale = 4
mask = Image.new("L", (size * scale, size * scale), 0)
r = 0.497 * size * scale
c = size * scale / 2
ImageDraw.Draw(mask).ellipse((c - r, c - r, c + r, c + r), fill=255)
mask = mask.resize((size, size), Image.LANCZOS)
badge = src.copy()
badge.putalpha(mask)

badge.resize((640, 640), Image.LANCZOS).save(f"{OUT}/badge.webp", quality=85)
badge.resize((128, 128), Image.LANCZOS).save(f"{OUT}/badge-sm.webp", quality=90)

# Icons: the full square artwork (its corners are already deep navy).
square = src.convert("RGB")
square.resize((512, 512), Image.LANCZOS).save(f"{OUT}/icon.png", optimize=True)
square.resize((192, 192), Image.LANCZOS).save(f"{OUT}/icon-192.png", optimize=True)
square.resize((180, 180), Image.LANCZOS).save(f"{OUT}/apple-touch-icon.png", optimize=True)
badge.resize((64, 64), Image.LANCZOS).save("apps/web/src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("done")
