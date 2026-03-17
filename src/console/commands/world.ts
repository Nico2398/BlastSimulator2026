// BlastSimulator2026 — Console commands for world creation and inspection

import type { CommandResult } from '../ConsoleRunner.js';
import { createGame, type GameState } from '../../core/state/GameState.js';
import { getMinePreset, getAllMinePresets } from '../../core/world/MineType.js';
import { generateTerrain } from '../../core/world/TerrainGen.js';
import { getRock } from '../../core/world/RockCatalog.js';
import { getOre } from '../../core/world/OreCatalog.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';

/** Shared game context for console commands. */
export interface GameContext {
  state: GameState | null;
  grid: VoxelGrid | null;
  /** Event emitter for game-over and campaign events. Listeners attached in main.ts/console.ts. */
  emitter: EventEmitter;
}

const DEFAULT_GRID_SIZE = 64;

export function newGameCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const mineType = named['mine_type'] ?? 'desert';
  const seed = named['seed'] ? parseInt(named['seed'], 10) : Date.now() % 100000;

  const preset = getMinePreset(mineType);
  if (!preset) {
    const valid = getAllMinePresets().map(p => p.id).join(', ');
    return { success: false, output: `Unknown mine type: "${mineType}". Valid: ${valid}` };
  }

  const size = named['size'] ? parseInt(named['size'], 10) : DEFAULT_GRID_SIZE;
  ctx.state = createGame({ seed, mineType });
  ctx.state.world = { sizeX: size, sizeY: size, sizeZ: size, gridReady: true };
  ctx.grid = generateTerrain({ sizeX: size, sizeY: size, sizeZ: size, seed, preset });

  return {
    success: true,
    output: `Game created. ${size}x${size}x${size} terrain, ${mineType} biome, seed ${seed}.`,
  };
}

export function inspectCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.grid) return { success: false, output: 'No game loaded. Use new_game first.' };

  const coords = (args[0] ?? '').split(',').map(Number);
  if (coords.length < 3 || coords.some(isNaN)) {
    return { success: false, output: 'Usage: inspect x,y,z' };
  }
  const [x, y, z] = coords as [number, number, number];

  if (!ctx.grid.isInBounds(x, y, z)) {
    return {
      success: false,
      output: `Out of bounds: (${x},${y},${z}). Grid is ${ctx.grid.sizeX}x${ctx.grid.sizeY}x${ctx.grid.sizeZ}.`,
    };
  }

  const v = ctx.grid.getVoxel(x, y, z)!;
  if (v.density === 0) {
    return { success: true, output: `(${x},${y},${z}): Air (empty)` };
  }

  const rock = getRock(v.rockId);
  const rockName = rock ? rock.id : v.rockId;
  const oreLines = Object.entries(v.oreDensities)
    .map(([id, d]) => {
      const ore = getOre(id);
      return `  ${ore ? ore.id : id}: ${(d * 100).toFixed(0)}%`;
    });
  const oreStr = oreLines.length > 0 ? '\nOres:\n' + oreLines.join('\n') : '\nOres: none';

  return {
    success: true,
    output: `(${x},${y},${z}): ${rockName} | density: ${v.density} | fracture mod: ${v.fractureModifier}${oreStr}`,
  };
}

export function terrainInfoCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state || !ctx.grid) {
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }

  const w = ctx.state.world!;
  let solidCount = 0;
  let airCount = 0;
  for (let x = 0; x < ctx.grid.sizeX; x++) {
    for (let z = 0; z < ctx.grid.sizeZ; z++) {
      for (let y = 0; y < ctx.grid.sizeY; y++) {
        const v = ctx.grid.getVoxel(x, y, z)!;
        if (v.density > 0) solidCount++;
        else airCount++;
      }
    }
  }

  return {
    success: true,
    output: [
      `Grid: ${w.sizeX}x${w.sizeY}x${w.sizeZ}`,
      `Mine type: ${ctx.state.mineType}`,
      `Seed: ${ctx.state.seed}`,
      `Solid voxels: ${solidCount}`,
      `Air voxels: ${airCount}`,
    ].join('\n'),
  };
}

export function surveyCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.grid) return { success: false, output: 'No game loaded. Use new_game first.' };

  const coords = (args[0] ?? '').split(',').map(Number);
  if (coords.length < 2 || coords.some(isNaN)) {
    return { success: false, output: 'Usage: survey x,z' };
  }
  const [x, z] = coords as [number, number];

  if (x < 0 || x >= ctx.grid.sizeX || z < 0 || z >= ctx.grid.sizeZ) {
    return {
      success: false,
      output: `Out of bounds: (${x},${z}). Grid is ${ctx.grid.sizeX}x${ctx.grid.sizeZ}.`,
    };
  }

  // Find surface (topmost solid voxel)
  let surfaceY = -1;
  for (let y = ctx.grid.sizeY - 1; y >= 0; y--) {
    const v = ctx.grid.getVoxel(x, y, z)!;
    if (v.density > 0) {
      surfaceY = y;
      break;
    }
  }

  if (surfaceY < 0) {
    return { success: true, output: `Survey at (${x},${z}): No solid ground.` };
  }

  const v = ctx.grid.getVoxel(x, surfaceY, z)!;
  const rock = getRock(v.rockId);
  const rockName = rock ? rock.id : v.rockId;
  const oreLines = Object.entries(v.oreDensities)
    .map(([id, d]) => `${id}: ${(d * 100).toFixed(0)}%`);
  const oreStr = oreLines.length > 0 ? oreLines.join(', ') : 'none';

  return {
    success: true,
    output: `Survey at (${x},${z}): ${rockName} at depth ${surfaceY}. Ores: ${oreStr}`,
  };
}
