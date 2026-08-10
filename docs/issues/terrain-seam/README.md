# Terrain seam / closed-volume evidence

Screenshots captured for the playable-mesh ↔ landscape-mesh boundary issues.
Captured headless at 1600×900 from the dev server, one browser session, camera
placed via `window.__cameraFocus` / `window.__cameraOrbit`.

| File | Site | Camera | What it shows |
|------|------|--------|---------------|
| `02-desert-edge-west-closeup.png` | `new_game seed:42 size:64`, desert_badlands | focus (2, 32), dist 45, yaw 90, pitch 14 | Bright slivers running along the site boundary — the playable mesh and the landscape do not meet cleanly. |
| `04-desert-topdown-boundary.png` | same | focus (32, 32), dist 150, pitch 82 | The site's square boundary etched across otherwise continuous ground. |
| `08-alpine-edge-closeup.png` | `sandbox start biome:alpine_granite seed:777` | focus (32, 3), dist 45, pitch 12 | Surface treatment changes across the boundary: lumpy high-frequency shading inside the site, smooth striated slopes outside. |
| `10-foothills-edge-closeup.png` | `sandbox start biome:green_foothills seed:2024` | focus (3, 32), dist 42, pitch 12 | Camera inside the terrain: the playable mesh's interior faces and perimeter skirt are drawn, i.e. the whole volume is meshed. |
| `11-karst-corner-grazing.png` | `sandbox start biome:tropical_karst seed:31337` | focus (4, 4), dist 60, yaw 225, pitch 10 | A hole at the junction — unlit void between the two meshes — and a mesh face standing proud of the landscape. |
| `12-karst-high-boundary.png` | same | focus (32, 32), dist 120, yaw 45, pitch 55 | Cracks along the boundary from above, plus a hard straight geometric edge where the site ends. |
