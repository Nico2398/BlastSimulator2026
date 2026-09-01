# #907 — the playable mesh and the landscape did not join

Captured headless at 1400x800 on `campaign start level:tutorial_pit cash:340000`,
one browser session per side, same three cameras before and after. `before-*` is
`main` at 4854d7e; `after-*` is the same commit with the fix applied and nothing
else changed.

| Camera | How it was placed |
|--------|-------------------|
| `default-camera` | The level's own opening camera, untouched — the view the playtest reported |
| `topdown-boundary` | `__cameraOrbit(0, 88)`, `__cameraFocus(16, 16, 70)` |
| `west-edge-oblique` | `__cameraOrbit(70, 8)`, `__cameraFocus(1, 16, 18)` |

The defect reads as a pale line or band along the west and north claim edges: it
is sky through a strip of ground neither sheet drew, with the playable mesh's
lip standing as a dark step beside it. `topdown-boundary` shows it as the site's
own L etched into open desert. The east and south edges carry the opposite
error — the two sheets overlap there rather than parting — which shows as a
blocky staircase silhouette when the boundary is seen from below.

## After a blast at the boundary

`*-blast-crater-topdown` is a real blast — six holes drilled, charged with 8 kg
of boomite and fired through the game loop at the site's west edge — on
tutorial_pit's own biome, seed and size, staffed (the campaign start hires
nobody, so no blast can be fired there) and paused so only the ticks the capture
asks for pass. Camera `__cameraOrbit(0, 80)`, `__cameraFocus(4, 11, 40)`.

Same crew, same vehicle, same muck pile, same day and same balance in both: the
only difference is the fix. Before, the bright L runs straight past the crater
it just opened.
