"""Generate Fiver's app icons into assets/.

Run this only when the mark changes — the output is committed so the
build and CI need no Python.  Usage: python3 icons.py
"""
from PIL import Image, ImageDraw
import os

GROUND = (25, 44, 66)      # deep alpine blue, darker than the UI accent so it holds on any home screen
BLOCK = (138, 190, 240)
BLOCK_DIM = (40, 63, 90)

os.makedirs('assets/icons', exist_ok=True)


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def icon(size, pad_ratio=0.0, bg=True):
    """A 3x3 grid with 5 blocks lit — the app's own 'day so far' motif."""
    ss = 4  # supersample for clean edges
    S = size * ss
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg:
        rounded(d, (0, 0, S, S), int(S * 0.22), GROUND)

    # maskable icons need their content inside the safe circle (80% of the canvas)
    inset = S * (0.20 + pad_ratio)
    grid = S - inset * 2
    # three across, five lit — big enough to read at 40px on a home screen,
    # and five blocks is the whole idea of the app
    cols = 3
    gap = grid * 0.11
    cell = (grid - gap * (cols - 1)) / cols
    lit = 5

    n = 0
    for row in range(cols):
        for col in range(cols):
            x = inset + col * (cell + gap)
            y = inset + row * (cell + gap)
            fill = BLOCK if n < lit else BLOCK_DIM
            rounded(d, (x, y, x + cell, y + cell), int(cell * 0.22), fill)
            n += 1

    return img.resize((size, size), Image.LANCZOS)


for size in (32, 180, 192, 512):
    icon(size).save(f'assets/icons/icon-{size}.png')

# maskable: same mark, more padding, background bleeds to the edges
icon(512, pad_ratio=0.06).save('assets/icons/maskable-512.png')

# favicon: multi-size ico
ico = icon(64)
ico.save('assets/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

print('icons written')
