// BlastSimulator2026 — Ghost Mesh Renderer
// Renders pending-action previews as blue translucent pulsing meshes.
// Each GhostPreview maps to a semi-transparent box at the target grid position.
// Opacity pulses between min and max to signal "waiting for worker" state.

import * as THREE from 'three';
import type { GhostPreview } from '../core/state/GameState.js';
import { getBuildingDef, getDefSize, getFootprintSize } from '../core/entities/Building.js';
import { footprintCenterCoord } from './MeshUtils.js';
import { instantiateBuildingModel } from './BuildingMesh.js';
import { modelLibrary, type ModelInstance, type ModelLibrary } from './models/ModelLibrary.js';
import { markSceneOverlay } from './post/SceneOverlay.js';

// ---------- Config ----------

const GHOST_COLOR     = 0x44aaff;        // blue tint
const EMISSIVE_COLOR  = new THREE.Color(0x1166cc); // deeper blue glow
const OPACITY_MIN     = 0.20;            // dimmest pulse value
const OPACITY_MAX     = 0.60;            // brightest pulse value
const PULSE_SPEED     = 2.2;             // radians / second
export const GHOST_SIZE = 0.9;           // box half-extent in metres
/**
 * Ghosts draw before the ramp arrow (RAMP_ARROW_RENDER_ORDER, #1211): a
 * ramp's per-layer ghost cubes stack right on its axis, and drawn after the
 * arrow their translucent blue would wash its yellow out.
 */
export const GHOST_RENDER_ORDER = 10;

// Unreachable-order ghost look (#1306): a rose-leaning red, kept >= 15 degrees
// of hue from the building exit marker (0xff4400, ~16 deg) and >= 30 degrees from
// the ramp arrow (0xffd21f, ~49 deg) so none of the three can be mistaken for another.
export const GHOST_UNREACHABLE_COLOR = new THREE.Color(0xff2a88);
const GHOST_UNREACHABLE_EMISSIVE = new THREE.Color(0xcc1166);
export const GHOST_UNREACHABLE_RIM_COLOR = new THREE.Color(0xff4a98);
export const GHOST_UNREACHABLE_OPACITY_MIN = 0.25;
export const GHOST_UNREACHABLE_OPACITY_MAX = 0.65;

// Claimed ghosts (an employee has claimed the action and is en route/working
// it, #547) read distinctly from unclaimed ones — dimmer and pulsing slower —
// while staying the same blue. Roughly half the opacity range and half the
// pulse speed of the unclaimed constants above.
const CLAIMED_OPACITY_MIN = 0.10;        // dimmest pulse value, claimed
const CLAIMED_OPACITY_MAX = 0.30;        // brightest pulse value, claimed
const CLAIMED_PULSE_SPEED = 1.1;         // radians / second, claimed

// Fresnel-based holographic rim-light (#613) — edges facing away from the
// camera glow brighter than faces facing it, layered on top of the existing
// pulse-opacity behaviour above. Same blue as GHOST_COLOR in both ghost
// states — no second color.
//
// The rim term is added into totalEmissiveRadiance, which the standard
// transparent alpha-blend then multiplies by the material's (pulsing,
// 0.10-0.60) `opacity` uniform before it reaches the screen — exactly where
// the rim should read strongest (thin grazing-angle sliver), the ghost is
// also most see-through, diluting it. RIM_OPACITY_FLOOR compensates: the rim
// contribution is divided by max(opacity, RIM_OPACITY_FLOOR) in-shader so its
// on-screen brightness stays roughly independent of the opacity pulse
// (floored rather than divided by raw opacity so it can't blow up as opacity
// approaches 0). Original tuning (RIM_INTENSITY 1.0, no compensation) pixel-
// sampled only a ~6-8% grazing-angle brightness delta — imperceptible at
// normal viewing distance (#613 visual feedback).
const RIM_COLOR         = new THREE.Color(GHOST_COLOR); // reuses ghost base color (the unreachable variant swaps in GHOST_UNREACHABLE_RIM_COLOR)
const RIM_POWER         = 1.5;           // fresnel exponent — widened vs 2.0 so the glow band reads as an edge, not a sliver
const RIM_INTENSITY     = 2.2;           // additive glow multiplier
const RIM_OPACITY_FLOOR = 0.25;          // floor for the opacity-compensation divisor (caps compensation at 4x)

/** Colours of one ghost look: the blue default, or the red unreachable variant (#1306). */
interface GhostPalette {
  color: THREE.ColorRepresentation;
  emissive: THREE.Color;
  rim: THREE.Color;
}

const BLUE_PALETTE: GhostPalette = { color: GHOST_COLOR, emissive: EMISSIVE_COLOR, rim: RIM_COLOR };
const RED_PALETTE: GhostPalette = {
  color: GHOST_UNREACHABLE_COLOR, emissive: GHOST_UNREACHABLE_EMISSIVE, rim: GHOST_UNREACHABLE_RIM_COLOR,
};

/** Builds a ghost mesh material at the given starting opacity — the unclaimed
 *  and claimed materials differ only in that value (#547 review); the red
 *  variant also differs in palette (#1306). */
function createGhostMaterial(opacity: number, palette: GhostPalette = BLUE_PALETTE): THREE.MeshPhongMaterial {
  const material = new THREE.MeshPhongMaterial({
    color: palette.color,
    emissive: palette.emissive,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Fresnel rim-light shader injection (#613) — edges facing away from the
  // camera glow brighter than faces facing it, layered on top of the
  // opacity pulse driven from update(). Identical GLSL for both claimed and
  // unclaimed materials; only opacity/pulse-speed differ between them.
  material.onBeforeCompile = (shader) => {
    shader.uniforms['rimColor'] = { value: palette.rim };
    shader.uniforms['rimPower'] = { value: RIM_POWER };
    shader.uniforms['rimIntensity'] = { value: RIM_INTENSITY };
    shader.uniforms['rimOpacityFloor'] = { value: RIM_OPACITY_FLOOR };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 rimColor;\nuniform float rimPower;\nuniform float rimIntensity;\nuniform float rimOpacityFloor;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
          'float rimFresnel = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), rimPower);\n' +
          'float rimOpacityCompensation = 1.0 / max(opacity, rimOpacityFloor);\n' +
          'totalEmissiveRadiance += rimColor * rimIntensity * rimFresnel * rimOpacityCompensation;',
      );
  };
  material.customProgramCacheKey = () => 'ghost-mesh-fresnel-v1';

  return material;
}

// ---------- Main class ----------

/** One drawn ghost: a bare box mesh, or a group wearing a building model (#1306). */
interface GhostEntry {
  root: THREE.Object3D;
  /** Every mesh that wears a ghost material. */
  meshes: THREE.Mesh[];
  /** Model instance behind a building hologram; null for a box. */
  instance: ModelInstance | null;
  /** A `place_building` box drawn only until its model has loaded. */
  standIn: boolean;
  preview: GhostPreview;
}

export class GhostMesh {
  private readonly scene: THREE.Scene;
  private readonly library: ModelLibrary;
  private readonly entries = new Map<number, GhostEntry>();
  /** Material for unclaimed ghosts — brighter, faster pulse. */
  private readonly material: THREE.MeshPhongMaterial;
  /** Material for claimed ghosts (#547) — dimmer, slower pulse, still blue. */
  private readonly claimedMaterial: THREE.MeshPhongMaterial;
  /** Material for unclaimed ghosts no capable actor can reach (#1306) — red, same pulse as unclaimed. */
  private readonly unreachableMaterial: THREE.MeshPhongMaterial;
  private time = 0;

  constructor(scene: THREE.Scene, library: ModelLibrary = modelLibrary) {
    this.scene = scene;
    this.library = library;
    this.material = createGhostMaterial(OPACITY_MIN);
    this.claimedMaterial = createGhostMaterial(CLAIMED_OPACITY_MIN);
    this.unreachableMaterial = createGhostMaterial(GHOST_UNREACHABLE_OPACITY_MIN, RED_PALETTE);
  }

  /** A claimed ghost is never red — an employee is already on the way (#1306). */
  private materialFor(preview: GhostPreview): THREE.MeshPhongMaterial {
    if (preview.claimed) return this.claimedMaterial;
    return preview.unreachable === true ? this.unreachableMaterial : this.material;
  }

  /**
   * Sync ghost meshes against the current ghost preview list.
   * Adds meshes for new previews and removes meshes for gone ones. A preview
   * whose `claimed`/`unreachable` flag flips in place (same id, existing mesh)
   * swaps that mesh's material rather than recreating it (#547, #1306).
   * Call after syncFromContext() whenever ghostPreviews may have changed.
   */
  sync(previews: GhostPreview[]): void {
    const activeIds = new Set(previews.map(p => p.id));

    for (const [id, entry] of this.entries) {
      if (!activeIds.has(id)) this.removeEntry(id, entry);
    }

    for (const preview of previews) {
      const existing = this.entries.get(preview.id);
      if (existing) {
        existing.preview = preview;
        this.applyMaterial(existing);
        continue;
      }
      const entry = this.createEntry(preview);
      this.entries.set(preview.id, entry);
      this.scene.add(entry.root);
    }
  }

  /**
   * Swap every building stand-in box for its model once the library has loaded
   * it (#1306). Call when `library.revision` changes.
   */
  refreshModels(): void {
    for (const [id, entry] of this.entries) {
      if (!entry.standIn) continue;
      const fresh = this.createEntry(entry.preview);
      if (fresh.standIn) {
        this.disposeEntry(fresh);
        continue;
      }
      this.removeEntry(id, entry);
      this.entries.set(id, fresh);
      this.scene.add(fresh.root);
    }
  }

  private applyMaterial(entry: GhostEntry): void {
    const material = this.materialFor(entry.preview);
    for (const mesh of entry.meshes) {
      if (mesh.material !== material) mesh.material = material;
    }
  }

  private createEntry(preview: GhostPreview): GhostEntry {
    const entry = preview.building !== undefined
      ? this.createBuildingEntry(preview, preview.building)
      : this.createBoxEntry(preview);
    this.applyMaterial(entry);
    return entry;
  }

  private createBoxEntry(preview: GhostPreview, standIn = false): GhostEntry {
    // A `place_building` ghost carries its real footprint (#556) — size and
    // center the box to the site's full bounding box instead of the fixed
    // single-point cube every other action type still gets. Mirrors how
    // BuildingMesh.ts centers a real building's box on its own footprint:
    // group position at footprintCenterCoord(x, sizeX)/footprintCenterCoord(z, sizeZ),
    // box sized sizeX x sizeZ (#1198).
    const mesh = new THREE.Mesh();
    if (preview.footprint) {
      const { sizeX, sizeZ } = getFootprintSize(preview.footprint);
      mesh.geometry = new THREE.BoxGeometry(sizeX, GHOST_SIZE, sizeZ);
      const origin = preview.building ?? { x: preview.targetX, z: preview.targetZ };
      mesh.position.set(
        footprintCenterCoord(origin.x, sizeX),
        preview.targetY + GHOST_SIZE / 2,
        footprintCenterCoord(origin.z, sizeZ),
      );
    } else {
      mesh.geometry = new THREE.BoxGeometry(GHOST_SIZE, GHOST_SIZE, GHOST_SIZE);
      mesh.position.set(preview.targetX, preview.targetY + GHOST_SIZE / 2, preview.targetZ);
    }
    mesh.renderOrder = GHOST_RENDER_ORDER;
    markSceneOverlay(mesh);
    return { root: mesh, meshes: [mesh], instance: null, standIn, preview };
  }

  /**
   * A queued building draws its own model as the hologram (#1306): every mesh
   * of the model wears the shared ghost material, standing where the real
   * building will (same footprint centring as BuildingMesh.addBuilding). While
   * the model has not loaded, the footprint box stands in.
   */
  private createBuildingEntry(preview: GhostPreview, building: NonNullable<GhostPreview['building']>): GhostEntry {
    const instance = instantiateBuildingModel(this.library, building.type, building.tier);
    if (instance.isFallback) {
      instance.dispose();
      return this.createBoxEntry(preview, true);
    }
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(building.type, building.tier));
    const group = new THREE.Group();
    group.add(instance.root);
    group.position.set(
      footprintCenterCoord(building.x, sizeX),
      preview.targetY,
      footprintCenterCoord(building.z, sizeZ),
    );
    const meshes: THREE.Mesh[] = [];
    instance.root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.renderOrder = GHOST_RENDER_ORDER;
      markSceneOverlay(obj);
      meshes.push(obj);
    });
    markSceneOverlay(group);
    return { root: group, meshes, instance, standIn: false, preview };
  }

  private removeEntry(id: number, entry: GhostEntry): void {
    this.scene.remove(entry.root);
    this.disposeEntry(entry);
    this.entries.delete(id);
  }

  /** Box geometry is the ghost's own; a model's geometry is shared with the library and stays. */
  private disposeEntry(entry: GhostEntry): void {
    if (entry.instance !== null) {
      entry.instance.dispose();
      return;
    }
    for (const mesh of entry.meshes) mesh.geometry.dispose();
  }

  /**
   * Animate ghost opacity. Call every frame with elapsed seconds.
   * Claimed and unclaimed ghosts pulse independently (#547).
   */
  update(dt: number): void {
    if (this.entries.size === 0) return;
    this.time += dt;
    const t = (Math.sin(this.time * PULSE_SPEED) + 1) * 0.5; // 0..1
    this.material.opacity = OPACITY_MIN + t * (OPACITY_MAX - OPACITY_MIN);
    this.unreachableMaterial.opacity = GHOST_UNREACHABLE_OPACITY_MIN
      + t * (GHOST_UNREACHABLE_OPACITY_MAX - GHOST_UNREACHABLE_OPACITY_MIN);
    const tc = (Math.sin(this.time * CLAIMED_PULSE_SPEED) + 1) * 0.5; // 0..1
    this.claimedMaterial.opacity = CLAIMED_OPACITY_MIN + tc * (CLAIMED_OPACITY_MAX - CLAIMED_OPACITY_MIN);
  }

  /** Remove all ghost meshes from the scene. */
  clearAll(): void {
    for (const [id, entry] of [...this.entries]) this.removeEntry(id, entry);
  }

  /** Number of ghost meshes currently rendered. */
  get count(): number {
    return this.entries.size;
  }

  /**
   * THREE.Object3D anchor for the ghost with pending-action id `id`, or
   * null when none exists (site not yet synced this frame, or gone). Lets
   * other renderer modules parent world-space UI to a construction site
   * without duplicating GhostMesh's own footprint-centering math (#1012).
   */
  getGroup(id: number): THREE.Object3D | null {
    return this.entries.get(id)?.root ?? null;
  }

  dispose(): void {
    this.clearAll();
    this.material.dispose();
    this.claimedMaterial.dispose();
    this.unreachableMaterial.dispose();
  }
}
