// BlastSimulator2026 — Ramp placement tool (multi-leg path, grade, readout, spiral)
// The tool only collects clicks and field values. Geometry, cost, validity, climb limits and the
// spiral proposal all come from the core helpers; this file wires them to the placement kit.

import { t } from '../core/i18n/I18n.js';
import type { PlacementKit } from './scene/PlacementKit.js';
import { placementRefusalReason } from './scene/PlacementKit.js';
import type { GameState } from '../core/state/GameState.js';
import { isProgressionSite } from '../core/state/GameState.js';
import type { GameConsoleFn } from './gameConsole.js';
import type { TileRegion } from './tutorialPickerRegion.js';
import type { ParamStripConfig } from './scene/ParamStrip.js';
import {
  proposeRampSpiral, isPitRim, type RampSpiralResult, type SpiralDir, type SpiralSurface,
} from '../core/mining/RampSpiral.js';
import {
  computeRampCost, rampDefFromEndpoints, rampCutSlopeRatio, rampDefFromLegs, rampEndTile, rampFloorDepthAt, rampGradeBoundsDegrees, validateRampOrder,
  type RampDef,
} from '../core/mining/Ramp.js';
import { legsFromWaypoints, rampLegsOf, rampPathOf, rampTotalLength, rampWaypoints, type RampLeg } from '../core/mining/RampPath.js';
import { climbForGrade, plannedRampGradeDegrees } from '../core/mining/RampGrade.js';
import {
  MAX_RAMP_LENGTH, RAMP_DEFAULT_WIDTH, RAMP_WIDTH_OPTIONS, RAMP_DEFAULT_DEPTH_M, RAMP_MAX_DEPTH_M, RAMP_GRADE_STEP_DEGREES, type RampWidth,
} from '../core/config/balance.js';
import { describeRampPlan } from './describeRamp.js';
import { rampFootLine } from './rampFootLine.js';

interface RampToolDeps {
  kit: PlacementKit;
  getState: () => GameState | null;
  console: GameConsoleFn | undefined;
  setStatus: (text: string) => void;
  /** Ground-truth height sampler; null when unavailable. */
  sampler: ((x: number, z: number) => number) | null;
  /** Terrain seam for the spiral order; null when no grid is available. */
  spiralSurface: () => SpiralSurface | null;
}

interface Tile { x: number; z: number }

/** The only spiral direction the tool orders; the console command takes ccw too. */
const SPIRAL_DIR: SpiralDir = 'cw';

/** Grade bounds shown to the player: tenth-of-a-degree steps inside core's real range. */
function tenths(range: { min: number; max: number }): { lo: number; hi: number } {
  return { lo: Math.ceil(range.min * 10) / 10, hi: Math.floor(range.max * 10) / 10 };
}

export class RampTool {
  private depth = RAMP_DEFAULT_DEPTH_M;
  private width: RampWidth = RAMP_DEFAULT_WIDTH;
  /** Grade the player chose in degrees; null while the grade is automatic (the straight line to the depth). */
  private grade: number | null = null;
  /** Set when the Spiral button was pressed for this tile. */
  private spiralFrom: Tile | null = null;
  private spiralMemo: { key: string; result: RampSpiralResult } | null = null;

  constructor(private readonly deps: RampToolDeps) {}

  /** Arms the ramp tool, or cancels it when already armed. */
  arm(): void {
    const { kit } = this.deps;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }
    this.grade = null;
    this.spiralFrom = null;
    this.spiralMemo = null;

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      strip.show(this.stripConfig(refresh));
    };

    controller.setConfirmHandler((sel) => {
      const command = this.confirmCommand(sel);
      const cmd = command === null ? undefined : this.deps.console?.(command.line);
      if (!cmd?.success) {
        this.deps.setStatus(cmd?.output ?? '');
        return false;
      }
      this.deps.setStatus(t(command!.statusKey));
      overlay.flashConfirm();
      return true;
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'path' });
    const region = controller.activeRegion;
    if (region?.exact) this.clampDepthToExactRegion(region);
    refresh();
  }

  /**
   * Arm-time only (#1210): when the step pins the drag to a fixed exact
   * region, clamp the depth field DOWN (never up) to the deepest depth that
   * region's own fixed line still geometrically validates for. Cash is
   * forced to `Infinity` so only geometry (the slope/length gate), never
   * affordability, drives the clamp.
   */
  private clampDepthToExactRegion(region: TileRegion): void {
    const rampDef = rampDefFromEndpoints(region.x1, region.z1, region.x2, region.z2, this.depth, this.cutRatio());
    let depth = this.depth;
    while (depth > 1 && !validateRampOrder({ ...rampDef, targetDepth: depth }, Infinity).success) {
      depth--;
    }
    this.depth = depth;
  }

  /** Moves the ramp width one option up or down `RAMP_WIDTH_OPTIONS`, clamped at both ends. */
  private stepRampWidth(delta: 1 | -1): void {
    const i = RAMP_WIDTH_OPTIONS.indexOf(this.width) + delta;
    this.width = RAMP_WIDTH_OPTIONS[Math.min(RAMP_WIDTH_OPTIONS.length - 1, Math.max(0, i))]!;
  }

  /** Corner tiles drawn so far; the selection's two ends when the controller keeps none (exact region, harness picks). */
  private waypoints(): Tile[] {
    const { controller } = this.deps.kit;
    if (controller.activeRegion?.exact) return this.selectionEnds();
    const wps = controller.waypoints ?? [];
    return wps.length > 0 ? [...wps] : this.selectionEnds();
  }

  private selectionEnds(): Tile[] {
    const sel = this.deps.kit.controller.selection;
    if (!sel) return [];
    const first = { x: sel.x1, z: sel.z1 };
    return sel.x1 === sel.x2 && sel.z1 === sel.z2 ? [first] : [first, { x: sel.x2, z: sel.z2 }];
  }

  /** The ramp the corners describe, or null before there are two of them. */
  private planDef(wps: readonly Tile[]): RampDef | null {
    if (wps.length < 2) return null;
    const exact = this.deps.kit.controller.activeRegion?.exact === true;
    const base = exact
      ? { ...rampDefFromEndpoints(wps[0]!.x, wps[0]!.z, wps[1]!.x, wps[1]!.z, this.depth, this.cutRatio()), width: this.width }
      : this.defFromWaypoints(wps);
    if (base === null) return null;
    const grade = this.chosenGrade(this.gradeRange(rampTotalLength(rampLegsOf(base))));
    return grade === null ? base : { ...base, gradeDegrees: grade };
  }

  private defFromWaypoints(wps: readonly Tile[]): RampDef | null {
    const legs = legsFromWaypoints(wps);
    return legs.success ? rampDefFromLegs({ x: legs.originX, z: legs.originZ }, legs.legs, this.depth, this.width, this.cutRatio()) : null;
  }

  /** Rise per metre of run a ramp is cut at on this site: just under the vehicle limit on a progression site (#2045). */
  private cutRatio(): number {
    const state = this.deps.getState();
    return rampCutSlopeRatio(state !== null && isProgressionSite(state));
  }

  /** Whole-and-tenth degrees the grade may take over `totalLength` metres; a lone corner reasons over the longest ramp. */
  private gradeRange(totalLength: number | null): { lo: number; hi: number } {
    return tenths(rampGradeBoundsDegrees(totalLength ?? MAX_RAMP_LENGTH, this.depth, this.cutRatio()));
  }

  /** The chosen grade clamped into `range`; null while automatic, inert under an exact region, or when no grade fits. Pure. */
  private chosenGrade(range: { lo: number; hi: number }): number | null {
    if (this.grade === null || this.deps.kit.controller.activeRegion?.exact || range.lo > range.hi) return null;
    return Math.min(range.hi, Math.max(range.lo, this.grade));
  }

  private stepGrade(delta: 1 | -1, shown: number, range: { lo: number; hi: number }): void {
    if (this.deps.kit.controller.activeRegion?.exact || range.lo > range.hi) return;
    const next = Math.round((shown + delta * RAMP_GRADE_STEP_DEGREES) * 10) / 10;
    this.grade = Math.min(range.hi, Math.max(range.lo, next));
  }

  /** The spiral the Spiral button asked for, memoised on everything it reads. */
  private spiralResult(from: Tile, surface: SpiralSurface): RampSpiralResult {
    const key = `${from.x},${from.z}|${this.depth}|${this.width}|${this.grade}`;
    if (this.spiralMemo?.key === key) return this.spiralMemo.result;
    const result = this.proposeSpiral(from, surface);
    this.spiralMemo = { key, result };
    return result;
  }

  /** A chosen grade is proposed as is; an automatic one starts at the steepest grade and gentles by whole degrees until the pit fits a road (the steepest fit is the shortest, fastest road). */
  private proposeSpiral(from: Tile, surface: SpiralSurface): RampSpiralResult {
    const ask = (gradeDegrees: number): RampSpiralResult => proposeRampSpiral(
      { fromX: from.x, fromZ: from.z, depth: this.depth, gradeDegrees, width: this.width, dir: SPIRAL_DIR, cutSlopeRatio: this.cutRatio() }, surface,
    );
    const { lo, hi } = this.gradeRange(null);
    const chosen = this.chosenGrade({ lo, hi });
    if (chosen !== null) return ask(chosen);
    const steepest = ask(hi);
    if (steepest.success) return steepest;
    for (let g = Math.round((hi - RAMP_GRADE_STEP_DEGREES) * 10) / 10; g >= lo; g = Math.round((g - RAMP_GRADE_STEP_DEGREES) * 10) / 10) {
      const result = ask(g);
      if (result.success) return result;
    }
    return steepest;
  }

  private spiralSurfaceAt(wps: readonly Tile[]): SpiralSurface | null {
    if (wps.length !== 1 || this.deps.kit.controller.activeRegion?.exact) return null;
    const surface = this.deps.spiralSurface();
    return surface !== null && isPitRim(surface, wps[0]!) ? surface : null;
  }

  /** The console line a Confirm sends and the status it reports; null when nothing is orderable. */
  private confirmCommand(sel: { x1: number; z1: number; x2: number; z2: number }): { line: string; statusKey: string } | null {
    const wps = this.waypoints();
    const surface = this.spiralSurfaceAt(wps);
    if (surface !== null && this.spiralFrom !== null) {
      const result = this.spiralResult(this.spiralFrom, surface);
      if (!result.success) return null;
      const { gradeDegrees, depth } = result.proposal;
      return {
        line: `ramp spiral from:${this.spiralFrom.x},${this.spiralFrom.z} depth:${depth} grade:${gradeDegrees} width:${this.width} dir:${SPIRAL_DIR}`,
        statusKey: 'ui.build.ramp_spiral_ordered',
      };
    }
    const def = this.planDef(wps);
    if (def === null) return null;
    const gradeArg = def.gradeDegrees === undefined ? '' : ` grade:${def.gradeDegrees}`;
    const tail = `depth:${this.depth} width:${this.width}${gradeArg}`;
    const line = wps.length > 2
      ? `build_ramp path:${wps.map(w => `${w.x},${w.z}`).join(';')} ${tail}`
      : `build_ramp start:${sel.x1},${sel.z1} end:${sel.x2},${sel.z2} ${tail}`;
    return { line, statusKey: 'ui.build.ramp_ordered' };
  }

  /** Foot line of the last leg: its start and end ground, and the depth the floor still has to drop over it. */
  private footLine(def: RampDef): string {
    const sampler = this.deps.sampler;
    if (!sampler) return '';
    const legs = rampLegsOf(def);
    const last = legs[legs.length - 1]!;
    const total = rampTotalLength(legs);
    const wps = rampWaypoints(rampPathOf(def));
    const start = wps[wps.length - 2]!;
    const end = rampEndTile(def);
    const dropBefore = rampFloorDepthAt(total - last.length, total, def.targetDepth, def.gradeDegrees);
    return rampFootLine(sampler(start.x, start.z), sampler(end.x, end.z), def.targetDepth - dropBefore, last.length);
  }

  private stripConfig(refresh: () => void): ParamStripConfig {
    const { controller, overlay } = this.deps.kit;
    const state = this.deps.getState();
    const exact = controller.activeRegion?.exact === true;
    const wps = this.waypoints();
    const surface = this.spiralSurfaceAt(wps);
    // A spiral preview belongs to the one corner it was asked for.
    if (this.spiralFrom !== null && (surface === null || this.spiralFrom.x !== wps[0]!.x || this.spiralFrom.z !== wps[0]!.z)) {
      this.spiralFrom = null;
    }
    const spiral = surface !== null && this.spiralFrom !== null ? this.spiralResult(this.spiralFrom, surface) : null;
    const progression = state !== null && isProgressionSite(state);

    let def: RampDef | null = null;
    let legsPreview: { originX: number; originZ: number; legs: RampLeg[] } | undefined;
    let planGrade = 0;
    if (spiral?.success) {
      const p = spiral.proposal;
      def = { ...rampDefFromLegs({ x: p.originX, z: p.originZ }, p.legs, p.depth, this.width, this.cutRatio()), gradeDegrees: p.gradeDegrees };
      legsPreview = { originX: p.originX, originZ: p.originZ, legs: p.legs };
      planGrade = p.gradeDegrees;
    } else if (spiral === null) {
      def = this.planDef(wps);
      if (def !== null) {
        planGrade = plannedRampGradeDegrees(def);
        if (def.legs) legsPreview = { originX: def.originX, originZ: def.originZ, legs: def.legs };
      }
    }
    const totalLength = def === null ? null : rampTotalLength(rampLegsOf(def));
    const validation = def === null ? null : validateRampOrder(def, state?.cash ?? 0);

    let confirmDisabledReason: string | undefined;
    if (!controller.canConfirm) confirmDisabledReason = placementRefusalReason(controller);
    else if (spiral !== null && !spiral.success) confirmDisabledReason = t(spiral.reasonKey, spiral.params);
    else if (validation && !validation.success) {
      confirmDisabledReason = validation.messageKey ? t(validation.messageKey, validation.messageParams) : validation.message;
    } else if (def === null && !exact) confirmDisabledReason = t('ui.build.ramp_instruction_path');
    const confirmEnabled = controller.canConfirm && (validation?.success ?? false);

    const sel = controller.selection;
    const refused = !confirmEnabled && sel !== null && (wps.length >= 2 || spiral !== null);
    overlay.update(spiral?.success && legsPreview
      ? { shape: 'line', x1: legsPreview.originX, z1: legsPreview.originZ, x2: legsPreview.originX, z2: legsPreview.originZ, width: this.width, refused: !confirmEnabled, legs: legsPreview }
      : sel
        ? { shape: 'line', x1: sel.x1, z1: sel.z1, x2: sel.x2, z2: sel.z2, width: this.width, refused, ...(legsPreview ? { legs: legsPreview } : {}) }
        : null);

    // A spiral reasons over the longest ramp (its length is the road's, not the drawn one), so its grade range is the lone-corner one.
    const range = this.gradeRange(spiral === null ? totalLength : null);
    const shownGrade = spiral !== null
      ? (spiral.success ? spiral.proposal.gradeDegrees : this.chosenGrade(range) ?? range.lo)
      : this.chosenGrade(range) ?? (def === null ? range.lo : Math.ceil(planGrade * 10) / 10);
    const cost = def === null || totalLength === null ? 0 : (validation?.success ? validation.cost : computeRampCost(totalLength, this.width));
    const readout = def === null || totalLength === null ? [] : describeRampPlan({
      length: totalLength, legs: rampLegsOf(def).length, cost, gradeDeg: planGrade,
      climb: progression ? climbForGrade(planGrade, true) : null,
    });
    const actions: NonNullable<ParamStripConfig['actions']> = [];
    if (!exact && wps.length > 0) {
      actions.push({ key: 'ramp-undo-corner', label: t('ui.build.ramp_undo_corner'), onClick: () => controller.popWaypoint() });
    }
    if (surface !== null) {
      actions.push({
        key: 'ramp-spiral', label: t('ui.build.ramp_spiral'),
        onClick: () => { this.spiralFrom = { ...wps[0]! }; refresh(); },
      });
    }

    return {
      icon: 'down',
      title: t('ui.build.ramp'),
      subtitle: spiral?.success
        ? t('ui.build.ramp_spiral_preview', { length: spiral.proposal.totalLength, legs: spiral.proposal.legs.length, cost: validation?.cost ?? 0 })
        : def === null ? '' : this.footLine(def),
      fields: [
        { key: 'depth', label: t('ui.build.ramp_depth'), value: this.depth, format: v => `${v}m`, onDec: () => { this.depth = Math.max(1, this.depth - 1); refresh(); }, onInc: () => { this.depth = Math.min(RAMP_MAX_DEPTH_M, this.depth + 1); refresh(); } },
        { key: 'width', label: t('ui.build.ramp_width'), value: this.width, format: v => `${v}m`, onDec: () => { this.stepRampWidth(-1); refresh(); }, onInc: () => { this.stepRampWidth(1); refresh(); } },
        { key: 'grade', label: t('ui.build.ramp_grade'), value: shownGrade, format: v => `${v}°`, onDec: () => { this.stepGrade(-1, shownGrade, range); refresh(); }, onInc: () => { this.stepGrade(1, shownGrade, range); refresh(); } },
      ],
      result: totalLength === null ? '—' : `${totalLength} ${t('ui.tile_select.tiles')}`,
      confirmEnabled,
      confirmDisabledReason,
      readout,
      actions,
      instruction: exact ? t('ui.build.ramp_instruction')
        : spiral !== null ? t('ui.build.ramp_spiral_instruction') : t('ui.build.ramp_instruction_path'),
    };
  }
}
