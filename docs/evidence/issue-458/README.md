# Terrain fix evidence (#458)

Visual proof for the two terrain fixes on this branch. Every pair is the same
level, seed, camera and **in-game time** — the sun moves between shots, so an
unmatched pair says nothing about shading.

Captured with `new_game seed:42 size:24; campaign start level:tutorial_pit`,
1280x720, headless Chromium (software rasterisation, so the edges are jaggier
than a real GPU would draw them).

| Pair | Camera (focus x,z / distance / yaw / pitch) | Shows |
|------|--------------------------------------------|-------|
| `discontinuity-*-wide` | 16,16 / 60 / 30deg / 32deg | The whole site against the surrounding landscape |
| `discontinuity-*-rim`  | 16,0 / 26 / 0deg / 22deg   | The northern rim, where the two meshes meet |
| `lines-*`              | 16,20 / 12 / 45deg / 35deg | Ground close up, where the ruled lines were clearest |

**discontinuity** — before, the playable area is terraced into 1 m steps while
the landscape beside it is smooth, and the two meet at a break. After, the
surface lands on its true continuous height and runs into the landscape.

**lines** — before, fine parallel lines follow the ground's contours. After,
they are gone and the terrain still casts its shadows (visible on the right).

## Second round (`lines2-*`)

The first shadow fix reduced the lines but did not remove them — the
`lines-after` shot above still shows faint contour ripple, which round two
traced to the terrain mesh's inverted triangle winding. `lines2-before-*` is
the shipped first fix (the state with residual lines); `lines2-after-*` is the
winding fix plus back-face shadow rendering, at the same cameras and in-game
times. `lines2-after-rim` and `lines2-after-crater` are extra angles of the
fixed build: the mid-distance slope where the ripple was worst, and a blast
crater with its fragment pile proving freshly cut faces and debris survived
the winding flip.
