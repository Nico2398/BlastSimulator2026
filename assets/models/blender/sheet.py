"""Tile model preview captures into one contact sheet for quick review.

    python3 assets/models/blender/sheet.py [--cols 4] [--cell 320] [--out screenshots/models/sheet.png] [name-filter...]

Reads screenshots/models/*.png written by `npm run models:preview`; every name filter must match.
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SHOT_DIR = os.path.join(ROOT, 'screenshots', 'models')


def main(argv: list[str]) -> int:
    cols, cell, out = 4, 320, os.path.join(SHOT_DIR, 'sheet.png')
    filters: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--cols':
            cols = int(argv[i + 1]); i += 1
        elif a == '--cell':
            cell = int(argv[i + 1]); i += 1
        elif a == '--out':
            out = argv[i + 1]; i += 1
        else:
            filters.append(a)
        i += 1
    files = sorted(f for f in os.listdir(SHOT_DIR) if f.endswith('.png') and f != os.path.basename(out))
    if filters:
        files = [f for f in files if all(x in f for x in filters)]
    if not files:
        print('no captures found', file=sys.stderr)
        return 1
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 18)), (30, 30, 34))
    draw = ImageDraw.Draw(sheet)
    for idx, f in enumerate(files):
        im = Image.open(os.path.join(SHOT_DIR, f)).convert('RGB')
        im.thumbnail((cell, cell))
        x = (idx % cols) * cell
        y = (idx // cols) * (cell + 18)
        sheet.paste(im, (x, y + 18))
        draw.text((x + 4, y + 3), f[:-4], fill=(235, 235, 235))
    sheet.save(out)
    print(f'wrote {out} ({len(files)} captures)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
