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

import importlib
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import finish, finish_far, reset_scene  # noqa: E402


def _registry() -> dict[str, tuple[str, callable]]:
    import workers
    reg: dict[str, tuple[str, callable]] = {}
    for role in workers.ROLES:
        reg[f'worker_{role}'] = ('workers', (lambda r: (lambda: workers.build_worker(r)))(role))
    # Vehicles: tier 2 is the straight-faced model in vehicles.py; tiers 1 and
    # 3 are the caricatures in vehicles_t1.py / vehicles_t3.py, each exposing
    # build_vehicle(role). A tier module still being written is simply absent.
    import vehicles
    tier_modules = {2: vehicles}
    for tier, mod_name in ((1, 'vehicles_t1'), (3, 'vehicles_t3')):
        try:
            tier_modules[tier] = importlib.import_module(mod_name)
        except ImportError:
            pass
    for role in vehicles.ROLES:
        for tier, mod in tier_modules.items():
            reg[f'vehicle_{role}_t{tier}'] = ('vehicles', (lambda m_, r: (lambda: m_.build_vehicle(r)))(mod, role))
    # Buildings: buildings.py draws every tier; buildings_t1.py / buildings_t3.py
    # override the tiers they caricature through build_building(btype).
    import buildings
    overrides = {}
    for tier, mod_name in ((1, 'buildings_t1'), (3, 'buildings_t3')):
        try:
            overrides[tier] = importlib.import_module(mod_name)
        except ImportError:
            pass
    for name, builder in buildings.registry().items():
        reg[name] = ('buildings', builder)
    for btype in buildings.TYPE_BUILDERS:
        for tier, mod in overrides.items():
            if hasattr(mod, 'build_building'):
                reg[f'building_{btype}_t{tier}'] = ('buildings', (lambda m_, b: (lambda: m_.build_building(b)))(mod, btype))
    import props
    for name, builder in props.registry().items():
        reg[name] = ('props', builder)
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
        # Trees are drawn by the thousand: a decimated far-distance copy rides along.
        if name.startswith('prop_tree_'):
            finish_far(name)
        print(f'[models] {name} done in {time.time() - t0:.1f}s')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
