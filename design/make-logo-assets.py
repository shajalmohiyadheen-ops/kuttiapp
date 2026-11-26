"""Builds the web app's logo and icons from design/express-cash-xc-icon.png (the "XC" mark).

The source has its own glowing rounded frame on black. Phones draw their own rounded mask,
so the icon is cropped to the inside of that frame and the leftover edge glow is blended
into the navy, which avoids a double frame on the home screen.

- xc.png / xc-sm.png: the same mark for the sign-in screen and headers
- icon.png, icon-192.png, apple-touch-icon.png, favicon.ico: app and browser icons

Run: python3 design/make-logo-assets.py   (needs Pillow and numpy)
"""
import numpy as np
from PIL import Image

SRC = "design/express-cash-xc-icon.png"
OUT = "apps/web/public"
CONTENT = (118, 330, 1135, 885)  # the XC, the train and "BY SHAJAL SPEAKS", inside the drawn frame
SIDE = 1180  # canvas size; the content sits centred with breathing room for the phone's mask

src = Image.open(SRC).convert("RGB")
piece = np.asarray(src.crop(CONTENT)).astype(np.float32)
h, w = piece.shape[:2]
# Fresh navy background (the source's interior colours) so none of the frame glow comes along.
yy, xx = np.mgrid[0:SIDE, 0:SIDE].astype(np.float32) / (SIDE - 1)
# Match the background to the colour along the piece's top and bottom edges so no seam shows.
top = piece[:6].reshape(-1, 3).mean(0)
bottom = piece[-6:].reshape(-1, 3).mean(0)
x0, y0 = (SIDE - w) // 2 + 8, (SIDE - h) // 2
rel = np.clip((yy * (SIDE - 1) - y0) / (h - 1), -0.6, 1.6)
canvas = top + (bottom - top) * rel[..., None]
canvas = np.clip(canvas, 0, 255)
x0, y0 = (SIDE - w) // 2 + 8, (SIDE - h) // 2
# Feather the pasted piece's edges into the background.
fe = 90
ey = np.minimum(np.arange(h), np.arange(h)[::-1])[:, None]
ex = np.minimum(np.arange(w), np.arange(w)[::-1])[None, :]
alpha = (np.clip(np.minimum(ey, ex) / fe, 0, 1) ** 1.2)[..., None]
region = canvas[y0:y0 + h, x0:x0 + w]
canvas[y0:y0 + h, x0:x0 + w] = piece * alpha + region * (1 - alpha)
icon = Image.fromarray(canvas.astype(np.uint8), "RGB")
n = SIDE

icon.resize((512, 512), Image.LANCZOS).save(f"{OUT}/icon.png", optimize=True)
icon.resize((192, 192), Image.LANCZOS).save(f"{OUT}/icon-192.png", optimize=True)
icon.resize((180, 180), Image.LANCZOS).save(f"{OUT}/apple-touch-icon.png", optimize=True)
icon.resize((320, 320), Image.LANCZOS).save(f"{OUT}/xc.png", optimize=True)
# Header mark and favicon: the same icon, smaller.
icon.resize((96, 96), Image.LANCZOS).save(f"{OUT}/xc-sm.png", optimize=True)
icon.resize((64, 64), Image.LANCZOS).convert("RGBA").save("apps/web/src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("ok", icon.size)
