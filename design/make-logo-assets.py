"""Builds the app's logo assets from design/kuttiapp-logo-original.png.

- Wordmark with a transparent background (header logo on web and mobile)
- App icon and splash image (the full square artwork)

Run: python3 design/make-logo-assets.py   (needs Pillow)
"""
from PIL import Image

SRC = "design/kuttiapp-logo-original.png"
BG = (6, 6, 32)  # the navy behind the wordmark


def color_to_alpha(img):
    """Turns the navy background transparent, keeping the gradient colours and soft glow."""
    out = Image.new("RGBA", img.size)
    p, o = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            c = p[x, y]
            a = max(max(0, c[i] - BG[i]) / (255 - BG[i]) for i in range(3))
            a = min(1, max(0, (a - 0.16) / 0.84))
            if a <= 0.01:
                o[x, y] = (0, 0, 0, 0)
                continue
            col = tuple(int(min(255, max(0, BG[i] + (c[i] - BG[i]) / a))) for i in range(3))
            o[x, y] = col + (int(a * 255),)
    return out


src = Image.open(SRC).convert("RGB")
word = color_to_alpha(src.crop((80, 415, 1070, 700)))
word = word.crop(word.getbbox())
pad = 10
logo = Image.new("RGBA", (word.width + 2 * pad, word.height + 2 * pad), (0, 0, 0, 0))
logo.paste(word, (pad, pad))
logo.save("apps/mobile/assets/logo.png")
logo.save("apps/web/public/logo.png")

src.resize((1024, 1024), Image.LANCZOS).save("apps/mobile/assets/icon.png")
src.save("apps/mobile/assets/splash.png")

# Square icon for the browser tab and Android adaptive icon: wordmark centred on navy.
for size, path in [(512, "apps/web/public/icon.png"), (1024, "apps/mobile/assets/android-icon-foreground.png")]:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    w = int(size * 0.62)  # stays inside Android's safe zone
    h = int(logo.height * w / logo.width)
    canvas.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    if path.endswith("icon.png") and "web" in path:
        bg = Image.new("RGBA", (size, size), (10, 11, 36, 255))
        bg.alpha_composite(canvas)
        canvas = bg
    canvas.save(path)
Image.new("RGBA", (1024, 1024), (10, 11, 36, 255)).save("apps/mobile/assets/android-icon-background.png")
mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
fg = Image.open("apps/mobile/assets/android-icon-foreground.png")
mono.paste(Image.new("RGBA", fg.size, (255, 255, 255, 255)), (0, 0), fg.split()[3])
mono.save("apps/mobile/assets/android-icon-monochrome.png")
print("logo", logo.size)
