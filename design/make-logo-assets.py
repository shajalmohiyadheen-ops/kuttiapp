"""Builds the web app's logo and icons from design/express-cash-xc-logo-v2.png (top half: the XC app icon).

The source draws its own rounded frame on a black margin. Phones round the icon themselves,
so only the inside is used: the XC, the train and "Powered By SHAJAL SPEAKS" are cut out and
placed full-bleed on the frame's own charcoal, with feathered edges so no seam shows.

- xc.png / xc-sm.png: the mark for the sign-in screen and headers
- icon.png, icon-192.png, apple-touch-icon.png, favicon.ico: app and browser icons

Run: python3 design/make-logo-assets.py   (needs Pillow and numpy)
"""
import numpy as np
from PIL import Image

SRC = "design/express-cash-xc-logo-v2.png"
OUT = "apps/web/public"
CONTENT = (205, 240, 1048, 712)  # inside the drawn frame: XC, train, "Powered By SHAJAL SPEAKS"
BG = (15, 15, 20)                # the frame's interior charcoal
SIDE = 1180
WIDTH = 950                      # content width on the canvas (about 80%, inside the phone's mask)

src = Image.open(SRC).convert("RGB")
piece_img = src.crop(CONTENT)
scale = WIDTH / piece_img.width
piece_img = piece_img.resize((WIDTH, round(piece_img.height * scale)), Image.LANCZOS)
piece = np.asarray(piece_img).astype(np.float32)
h, w = piece.shape[:2]
canvas = np.empty((SIDE, SIDE, 3), np.float32)
canvas[:] = BG
x0, y0 = (SIDE - w) // 2, (SIDE - h) // 2
fe = 40
ey = np.minimum(np.arange(h), np.arange(h)[::-1])[:, None]
ex = np.minimum(np.arange(w), np.arange(w)[::-1])[None, :]
alpha = np.clip(np.minimum(ey, ex) / fe, 0, 1)[..., None]
region = canvas[y0:y0 + h, x0:x0 + w]
canvas[y0:y0 + h, x0:x0 + w] = piece * alpha + region * (1 - alpha)
icon = Image.fromarray(canvas.astype(np.uint8), "RGB")

icon.resize((512, 512), Image.LANCZOS).save(f"{OUT}/icon.png", optimize=True)
icon.resize((192, 192), Image.LANCZOS).save(f"{OUT}/icon-192.png", optimize=True)
icon.resize((180, 180), Image.LANCZOS).save(f"{OUT}/apple-touch-icon.png", optimize=True)
icon.resize((320, 320), Image.LANCZOS).save(f"{OUT}/xc.png", optimize=True)
# Header mark: XC and train only, so it stays legible at 40 px.
head = src.crop((205, 235, 1048, 640))
side = head.width + 80
sq = Image.new("RGB", (side, side), BG)
sq.paste(head, (40, (side - head.height) // 2))
sq.resize((96, 96), Image.LANCZOS).save(f"{OUT}/xc-sm.png", optimize=True)
icon.resize((64, 64), Image.LANCZOS).convert("RGBA").save("apps/web/src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("ok", icon.size)
