"""App icons from brand/icon.svg (rectilinear shapes, drawn 1:1 on the 64-unit grid).

Store icons are full-bleed squares: iOS and the launcher apply their own mask,
so the SVG's rounded corner is dropped. Run after changing brand/icon.svg:
    python3 mobile-brand/icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
E = [(17, 16), (48, 16), (48, 24), (25, 24), (25, 29), (43, 29), (43, 36), (25, 36), (25, 41), (48, 41), (48, 49), (17, 49)]
BAR = [(48, 29), (53, 29), (53, 49), (48, 49)]


def icon(size: int) -> Image.Image:
    s = 8  # supersample, then downscale for clean edges
    img = Image.new("RGB", (64 * s, 64 * s), "#142D4E")
    d = ImageDraw.Draw(img)
    d.polygon([(x * s, y * s) for x, y in E], fill="#FFFFFF")
    d.polygon([(x * s, y * s) for x, y in BAR], fill="#087F8C")
    return img.resize((size, size), Image.LANCZOS)


out = HERE / "ios/AppIcon.appiconset"
out.mkdir(parents=True, exist_ok=True)
icon(1024).save(out / "icon-1024.png")
for density, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    d = HERE / f"android/res/mipmap-{density}"
    d.mkdir(parents=True, exist_ok=True)
    icon(px).save(d / "ic_launcher.png")
