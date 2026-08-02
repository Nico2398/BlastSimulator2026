# Plan: expanding, chunk-aggregated playable area

Replace the fixed square playable grid with a set of chunks that grows when the
player acts outside it. The site then has whatever shape play gives it, and is
seemingly unbounded — except where generated structures stand, which may never
be claimed and are what the border wall now marks.

Status: **planning only. No code written.** See §7 for what must land first.

---

## 1. Where the current design stands in the way

`VoxelGrid` is a dense SoA allocation of `sizeX * sizeY * sizeZ`, indexed from
the origin, and `playableRect` is literally `{0, 0, sizeX, sizeZ}`
(`WorldGen.ts`). Two consequences run through the whole codebase:

- **Coordinates are unsigned and bounded.** `isInBounds` gates every read, and
  roughly every consumer has its own `x >= 0 && x < sizeX` variant. A site that
  can grow west has negative coordinates, and every one of those checks is
  wrong in a way that fails silently — `densityAt` returns 0 out of bounds, so
  a mis-bounded read looks like air rather than throwing.
- **Size is fixed at generation.** `regenerateGrid` allocates once. Nothing in
  the save format, the navgrid, the minimap or the camera leash expects it to
  change afterwards.

The generator itself is the one part that is already ready: `sampleBaseHeight`
/ `sampleSurfaceVoxelY` are pure functions of `(x, z)` and the seed, with no
bound of their own. The world is *already* infinite; only the container is not.

## 2. Decisions

**D1 — Chunk as the unit of ownership.** 16×16 columns, full height, matching
the renderer's existing `CHUNK_SIZE` so a playable chunk maps 1:1 onto the mesh
chunks already being rebuilt on `terrain:updated`. Storage becomes
`Map<chunkKey, ChunkData>`, each chunk holding today's SoA arrays at 16×sizeY×16.

**D2 — Signed coordinates, converted at one seam.** World coordinates become
signed. Rather than auditing several hundred bound checks by hand, `VoxelGrid`
keeps its current *method surface* (`densityAt`, `setVoxel`, …) and resolves
`(x,y,z)` to a chunk internally. Callers that only read and write voxels need
no change; callers that iterate `0..sizeX` do, and those are findable
mechanically (§5).

**D3 — Lazy generation, pristine until touched.** A chunk is generated from the
world sampler the first time it is claimed. Because generation is a pure
function of position and seed, a chunk generated now and the same chunk
generated after ten hours of play are identical.

**D4 — Save only what play changed.** Save v7 stores the claimed-chunk set plus
the voxel data of chunks whose contents differ from their generated state.
Pristine chunks are regenerated on load from the seed. This is what keeps a
save from growing without bound as the site does, and it also fixes the
existing coupling where save size tracks level size rather than play.

**D5 — Expansion is an explicit, refusable operation.** `PlayableArea.claim(x, z)`
returns success or a refusal reason. Every action that can occur off-site
(drill, ramp, build, survey, vehicle move, blast fragment landing) routes
through it. Expansion is never implicit: something the player did must have
asked for it, or the site would creep outward on its own.

**D6 — Structures are inviolable, and that is what the wall means.** A chunk
overlapping a village, river or landmark footprint (`StructureSet`) can never
be claimed. `WorldBorderWall` stops drawing the site perimeter and instead
draws only the frontier between claimable ground and protected ground, keeping
its existing proximity fade so it appears when the player approaches one. The
wall becomes information rather than decoration: it is now the only thing in
the world that says "not here".

**D7 — Navgrid over the live bounding box.** Pathfinding keeps dense typed
arrays, sized to the bounding box of claimed chunks and rebuilt on expansion.
Expansion happens at human speed, so an O(area) rebuild per claim is fine, and
this avoids making A* chunk-aware — which would be a much larger change to the
code that #458 T6.2 just finished tuning.

**D8 — The landscape defers to the claimed set, not to a rect.**
`LandscapeMesh` currently cuts its tiles against `playableRect`. It cuts
against the claimed-chunk set instead. Both surfaces come from the same
sampler, so they agree by construction where they meet; the seam work from
#458 stays as is.

## 3. Phases

Each is independently verifiable and leaves the game playable.

**P0 — Make coordinates signed, keep one chunk.**
Introduce `ChunkedVoxelGrid` behind the existing method surface, backed by a
single chunk set covering exactly today's rect. Nothing about gameplay changes;
this is purely the storage swap. Done when the full suite passes unchanged.

**P1 — Claim/refuse service, no expansion yet.**
Add `PlayableArea` with the claimed set, `contains`, `claim`, and the structure
veto. Wire every off-site action to consult it, and have `claim` refuse
everything for now. Done when acting outside the site produces a clear refusal
instead of a silent no-op.

**P2 — Turn expansion on.**
`claim` generates and registers the chunk. Navgrid, physics region, camera
leash and minimap follow the new bounds. Done when a drill plan placed off the
east edge extends the site and is then workable.

**P3 — Save v7.**
Dirty-chunk serialisation with a v6 upgrade path. Done when a v6 save loads,
and a save taken after expanding restores the same shape.

**P4 — Border wall becomes the structure frontier.**
Perimeter geometry is rebuilt from the claimable/protected boundary. Done when
walking toward a village lights a wall and walking toward open ground does not.

**P5 — Renderer and UI catch up.**
Mesh iteration over the live chunk set, landscape cut against the claimed set,
minimap over arbitrary bounds and offsets.

## 4. What will break, and how it will show

- **Silent mis-bounds.** Out-of-range reads return air rather than throwing, so
  a missed bound check looks like a hole in the ground, not a crash. P0 should
  add a debug-mode assertion on reads outside any claimed chunk.
- **Scenario coordinates.** 82 of the scenario defs embed absolute coordinates
  that assume a site starting at the origin. They keep working as long as the
  initial claimed set matches today's rect, which is why P0 preserves it.
- **`worldSizeX/Z` in the state dump** is consumed by the playtest harness's
  tile mapping. It becomes a bounding box, not a size, and the harness needs
  the offset too.

## 5. Finding the call sites

The bounded-iteration sites are mechanically findable and should be enumerated
before P0 rather than discovered during it:

```
rg -n 'sizeX|sizeZ|playableRect|isInBounds' src/ --type ts
```

Ones already known to matter: `NavGrid`/`NavGridReachability` (dense arrays
sized from the grid), `TerrainBody` (region AABB), `LandscapeMap`
(`playableRect` exclusion), `TerrainMesh` (`ncx/ncy/ncz` dense loops),
`Minimap`, `CameraController.setPanLeash`, and the tile pickers.

## 6. Open questions for the human

- **Vertical extent.** Chunks are full-height here, so the world grows in X/Z
  only. Growing downward as well would let a pit outlive its level's floor; it
  is a bigger change and is deliberately out of scope.
- **Cost of claiming.** Expansion is currently free, which makes "seemingly
  infinite" also mean "infinitely cheap". A land-purchase price per chunk would
  fit the game's satire and give the border meaning beyond the structures, but
  it is a design decision, not a technical one.
- **Whether the initial site stays square.** P0 assumes it does. Starting from
  a single chunk and making the player claim outward is a different opening.

## 7. Blocked on

**The terrain shader's cost must come down first.** The material system
currently measures ~7.3s per frame at 1280×720 under software rasterisation,
against a 3.4s pre-existing baseline, and that is what turned the interaction
scenario suite from half an hour into hours. This plan makes strictly more
terrain visible at once. Landing it on top of an unfixed frame cost would
compound a regression that is already blocking CI.
