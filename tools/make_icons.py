"""Draw the app icons (icons/*.png): a 2x2 of rounded word tiles -- W N / ' F -- on the dark background.
   python tools/make_icons.py   (needs Pillow)"""
import pathlib
from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(__file__).resolve().parent.parent / 'icons'
OUT.mkdir(exist_ok=True)
BG, HIT, NEAR, MISS, HOT = (18, 16, 27), (32, 178, 107), (227, 169, 34), (58, 52, 82), (236, 72, 153)

def font(px):
    for name in ['seguisb.ttf', 'segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf']:
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            pass
    return ImageFont.load_default()

def draw(size, pad_frac, rounded=True):
    s = size * 4
    im = Image.new('RGB', (s, s), BG)
    d = ImageDraw.Draw(im)
    pad = int(s * pad_frac)
    gap = int(s * 0.04)
    cell = (s - 2 * pad - gap) // 2
    tiles = [('W', HIT), ('N', NEAR), ('&', HOT), ('F', MISS)]
    f = font(int(cell * 0.62))
    for i, (ch, col) in enumerate(tiles):
        x = pad + (i % 2) * (cell + gap)
        y = pad + (i // 2) * (cell + gap)
        r = int(cell * 0.2)
        shade = tuple(max(0, c - 40) for c in col)
        d.rounded_rectangle([x, y + int(cell * 0.05), x + cell, y + cell], r, fill=shade)
        d.rounded_rectangle([x, y, x + cell, y + int(cell * 0.95)], r, fill=col)
        d.text((x + cell / 2, y + cell * 0.47), ch, font=f, fill=(255, 255, 255), anchor='mm')
    return im.resize((size, size), Image.LANCZOS)

for sz in (180, 192, 512):
    draw(sz, 0.1).save(OUT / f'icon-{sz}.png')
draw(512, 0.2).save(OUT / 'icon-maskable-512.png')
print('icons written to', OUT)
