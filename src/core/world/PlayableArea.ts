// BlastSimulator2026 — Playable area: the site's claimed-chunk set (#473)
//
// The site is no longer a fixed square. It is a set of 16x16 chunks that grows
// when the player acts outside it, so it ends up whatever shape play gives it,
// and is seemingly unbounded — except where generated structures stand, which
// may never be claimed.
//
// Expansion is never implicit (#473 D5). Something the player did has to ask
// for it, through `claim`, which answers with a refusal reason rather than
// silently doing nothing — an off-site action that fails quietly is
// indistinguishable from a bug, which is exactly what the old dense grid did.

import { VoxelGrid, CHUNK_SIZE, chunkIndexOf } from './VoxelGrid.js';
import { buildTerrainContext, generateTerrainRegion, type TerrainConfig, type TerrainContext } from './TerrainGen.js';
import {
  buildProtectedStructures,
  rectTouchesProtectedStructure,
  type ProtectedStructures,
} from './Structures.js';
import type { Rect } from './WorldGen.js';

/** Why a claim was refused. */
export type ClaimRefusalReason =
  /** The chunk overlaps a village, river or landmark — inviolable ground (#473 D6). */
  | 'protected_structure'
  /**
   * The chunk shares no edge with the site.
   *
   * Not in #473's own refusal list — the issue leaves the question open. A
   * detached chunk would be an island nothing can walk to: the navgrid covers
   * the site's bounding box, so the ground between it and the site is 'void',
   * and every employee, vehicle and haul route would path into it and stop.
   * Refusing keeps the site one connected worksite while still letting it
   * grow without limit, one chunk at a time.
   */
  | 'not_adjacent'
  /** Expansion is disabled for this site (campaign levels with a fixed boundary). */
  | 'expansion_disabled';

export interface ClaimSuccess {
  claimed: true;
  chunk: { cx: number; cz: number };
  /** The world rect that became part of the site, max exclusive. */
  rect: Rect;
  /** True when the coordinate was already inside the site and nothing changed. */
  alreadyOwned: boolean;
}

export interface ClaimRefusal {
  claimed: false;
  chunk: { cx: number; cz: number };
  reason: ClaimRefusalReason;
}

export type ClaimResult = ClaimSuccess | ClaimRefusal;

export interface PlayableAreaOptions {
  /**
   * When false, `claim` refuses every expansion with `expansion_disabled`.
   * This is P1's behaviour and the escape hatch for a level that wants a
   * fixed boundary.
   */
  expansionEnabled?: boolean;
  /** Half-extent, in metres, of the area protected structures are searched in. Matches the landscape's own. */
  extentHalf?: number;
}

/**
 * Owns the claimed-chunk set for one game: answers whether a coordinate is on
 * the site, and takes the site outward when the player acts past its edge.
 *
 * `config` is the level's ORIGINAL terrain config, never the site's current
 * bounding box — generation is a pure function of position and seed, so a
 * chunk claimed after ten hours of play is identical to the same chunk
 * generated at level start (#473 D3).
 */
export class PlayableArea {
  private readonly grid: VoxelGrid;
  private readonly config: TerrainConfig;
  private readonly expansionEnabled: boolean;
  private readonly extentHalf: number | undefined;

  /** Both are expensive and only the claim path needs them — built on the first claim attempt, not at level start. */
  private terrain: TerrainContext | null = null;
  private protectedStructures: ProtectedStructures | null = null;

  constructor(grid: VoxelGrid, config: TerrainConfig, options: PlayableAreaOptions = {}) {
    this.grid = grid;
    this.config = config;
    this.expansionEnabled = options.expansionEnabled ?? true;
    this.extentHalf = options.extentHalf;
  }

  /**
   * Hand over an already-built protected set, so the claim path does not
   * re-trace rivers and re-place villages that something else (the landscape
   * build) has already computed for this seed. Ignored once the area has
   * built its own.
   */
  adoptStructures(structures: ProtectedStructures): void {
    if (!this.protectedStructures) this.protectedStructures = structures;
  }

  /**
   * True when the protected set is already available, so a caller can ask
   * `protectedFrontier` without triggering the trace.
   *
   * Building the set means tracing every river and placing every village for
   * the seed. That is fine on the claim path — the player just asked for
   * ground — but not on a render path, where it would block the frame the
   * level loads on.
   */
  hasStructures(): boolean {
    return this.protectedStructures !== null;
  }

  /** True when the site owns the column at (x, z). */
  contains(x: number, z: number): boolean {
    return this.grid.containsColumn(x, z);
  }

  /** The world rect chunk (cx, cz) spans, max exclusive. */
  static chunkRect(cx: number, cz: number): Rect {
    return {
      minX: cx * CHUNK_SIZE,
      minZ: cz * CHUNK_SIZE,
      maxX: cx * CHUNK_SIZE + CHUNK_SIZE,
      maxZ: cz * CHUNK_SIZE + CHUNK_SIZE,
    };
  }

  /** Chunk coordinates covering (x, z). */
  static chunkAt(x: number, z: number): { cx: number; cz: number } {
    return { cx: chunkIndexOf(x), cz: chunkIndexOf(z) };
  }

  /** True when the chunk covering (x, z) overlaps a protected structure and can never be claimed. */
  isProtected(x: number, z: number): boolean {
    const { cx, cz } = PlayableArea.chunkAt(x, z);
    return rectTouchesProtectedStructure(this.structures(), PlayableArea.chunkRect(cx, cz));
  }

  /**
   * Bring (x, z) onto the site, generating the chunk that covers it.
   *
   * Returns `alreadyOwned: true` without touching anything when the
   * coordinate is already inside — callers can therefore route every
   * potentially-off-site action through this without a separate `contains`
   * check.
   */
  claim(x: number, z: number): ClaimResult {
    const { cx, cz } = PlayableArea.chunkAt(x, z);

    if (this.contains(x, z)) {
      return { claimed: true, chunk: { cx, cz }, rect: PlayableArea.chunkRect(cx, cz), alreadyOwned: true };
    }
    if (!this.expansionEnabled) {
      return { claimed: false, chunk: { cx, cz }, reason: 'expansion_disabled' };
    }
    if (!this.grid.hasChunk(cx, cz) && !this.touchesSite(cx, cz)) {
      return { claimed: false, chunk: { cx, cz }, reason: 'not_adjacent' };
    }
    if (rectTouchesProtectedStructure(this.structures(), PlayableArea.chunkRect(cx, cz))) {
      return { claimed: false, chunk: { cx, cz }, reason: 'protected_structure' };
    }

    const grown = this.grid.addChunk(cx, cz);
    // `contains` said no, so the chunk was either absent or partially owned;
    // either way addChunk reports the rect that just became ours.
    const rect = grown ?? PlayableArea.chunkRect(cx, cz);
    this.generateInto(rect);
    this.grid.markChunkPristine(cx, cz);

    return { claimed: true, chunk: { cx, cz }, rect, alreadyOwned: false };
  }

  /**
   * Every chunk adjacent to the site that a claim would refuse — the frontier
   * the border wall marks (#473 D6/P4). Returned as world rects, max
   * exclusive, in chunk coordinates order.
   */
  protectedFrontier(): Array<{ cx: number; cz: number; rect: Rect }> {
    const seen = new Set<string>();
    const frontier: Array<{ cx: number; cz: number; rect: Rect }> = [];

    for (const { cx, cz } of this.grid.ownedChunks()) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, nz = cz + dz;
        const key = `${nx},${nz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.grid.hasChunk(nx, nz) && !this.grid.isChunkPartial(nx, nz)) continue;
        const rect = PlayableArea.chunkRect(nx, nz);
        if (rectTouchesProtectedStructure(this.structures(), rect)) frontier.push({ cx: nx, cz: nz, rect });
      }
    }
    return frontier;
  }

  /** True when chunk (cx, cz) shares an edge with a chunk the site already owns. */
  private touchesSite(cx: number, cz: number): boolean {
    return this.grid.hasChunk(cx - 1, cz)
      || this.grid.hasChunk(cx + 1, cz)
      || this.grid.hasChunk(cx, cz - 1)
      || this.grid.hasChunk(cx, cz + 1);
  }

  private generateInto(rect: Rect): void {
    if (!this.terrain) this.terrain = buildTerrainContext(this.config);
    generateTerrainRegion(this.grid, this.terrain, this.config, rect);
  }

  private structures(): ProtectedStructures {
    if (this.protectedStructures) return this.protectedStructures;
    if (!this.terrain) this.terrain = buildTerrainContext(this.config);
    const { fields, shapingAt, playableRect } = this.terrain.worldGen;
    this.protectedStructures = this.extentHalf !== undefined
      ? buildProtectedStructures(this.config.seed, fields, shapingAt, playableRect, this.extentHalf)
      : buildProtectedStructures(this.config.seed, fields, shapingAt, playableRect);
    return this.protectedStructures;
  }
}
