"""Build every game model (or a subset) with Blender's Python module.

    python3 assets/models/blender/build.py                # everything
    python3 assets/models/blender/build.py worker_driller  # one model
    python3 assets/models/blender/build.py workers vehicles buildings   # categories

Writes assets/models/blend/<name>.blend (editable, modifiers live) and
public/models/<name>.glb (modifiers applied). Buildings read their footprints
from building-defs.json, dumped from the game's BuildingDefs by
`npm run models:defs` so both sides agree on size.
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import finish, reset_scene  # noqa: E402


def _registry() -> dict[str, tuple[str, callable]]:
    import workers
    reg: dict[str, tuple[str, callable]] = {}
    for role in workers.ROLES:
        reg[f'worker_{role}'] = ('workers', (lambda r: (lambda: workers.build_worker(r)))(role))
    try:
        import vehicles
        for role in vehicles.ROLES:
            reg[f'vehicle_{role}'] = ('vehicles', (lambda r: (lambda: vehicles.build_vehicle(r)))(role))
    except ImportError:
        pass
    try:
        import buildings
        for name, builder in buildings.registry().items():
            reg[name] = ('buildings', builder)
    except ImportError:
        pass
    return reg


def main(argv: list[str]) -> int:
    reg = _registry()
    wanted = argv or list(reg)
    names: list[str] = []
    for w in wanted:
        if w in reg:
            names.append(w)
        else:
            matched = [n for n, (cat, _) in reg.items() if cat == w]
            if not matched:
                print(f'unknown model or category: {w}', file=sys.stderr)
                return 2
            names += matched
    for name in names:
        t0 = time.time()
        reset_scene()
        reg[name][1]()
        finish(name)
        print(f'[models] {name} done in {time.time() - t0:.1f}s')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
