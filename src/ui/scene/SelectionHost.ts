import type { GameState } from '../../core/state/GameState.js';
import type { Building } from '../../core/entities/Building.js';
import { getBuildingDef, getDefSize } from '../../core/entities/Building.js';
import { isInsideBuilding, mountedVehicleId } from '../../core/entities/EmployeeLocomotion.js';

/** Selection kinds whose on-screen anchor may be a host (building, vehicle, site) rather than the entity itself. */
type HostResolvedKind = 'employee' | 'vehicle' | 'building' | 'fragment';

/** Inclusive tile rectangle. */
interface SiteFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type SelectionAnchor =
  | { type: 'self' }
  | { type: 'host'; kind: 'building' | 'vehicle'; id: number }
  | { type: 'site'; footprint: SiteFootprint };

type SelectionResolution = { exists: false } | { exists: true; anchor: SelectionAnchor };

type SelectionWorld = Pick<
  GameState,
  'employees' | 'vehicles' | 'buildings' | 'plannedBuildings' | 'logistics'
>;

export function isHostResolvedKind(kind: string): kind is HostResolvedKind {
  return kind === 'employee' || kind === 'vehicle' || kind === 'building' || kind === 'fragment';
}

/** Inclusive tile rectangle a building (or its planned site) covers. */
export function buildingFootprint(b: Pick<Building, 'type' | 'tier' | 'x' | 'z'>): SiteFootprint {
  const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
  return { minX: b.x, maxX: b.x + sizeX - 1, minZ: b.z, maxZ: b.z + sizeZ - 1 };
}

const SELF: SelectionResolution = { exists: true, anchor: { type: 'self' } };

function hostOrSelf(
  world: SelectionWorld,
  kind: 'building' | 'vehicle',
  id: number,
): SelectionResolution {
  const resolvable = kind === 'building'
    ? world.buildings.buildings.some(b => b.id === id)
    : world.vehicles.vehicles.some(v => v.id === id);
  return resolvable ? { exists: true, anchor: { type: 'host', kind, id } } : SELF;
}

/** Where the selected entity's outline belongs, or that it no longer exists. One linear find, for the one selected entity. */
export function resolveSelection(
  world: SelectionWorld,
  kind: HostResolvedKind,
  id: number,
): SelectionResolution {
  switch (kind) {
    case 'employee': {
      const e = world.employees.employees.find(x => x.id === id);
      if (!e || !e.alive) return { exists: false };
      if (isInsideBuilding(e.locomotion)) return hostOrSelf(world, 'building', e.locomotion.buildingId);
      const vehicleId = mountedVehicleId(e.locomotion);
      return vehicleId === null ? SELF : hostOrSelf(world, 'vehicle', vehicleId);
    }
    case 'vehicle':
      return world.vehicles.vehicles.some(v => v.id === id) ? SELF : { exists: false };
    case 'building': {
      if (world.buildings.buildings.some(b => b.id === id)) return SELF;
      const site = world.plannedBuildings.find(pb => pb.buildingId === id);
      if (!site) return { exists: false };
      return { exists: true, anchor: { type: 'site', footprint: buildingFootprint(site) } };
    }
    case 'fragment': {
      const f = world.logistics.fragments.find(x => x.fragment.id === id);
      if (!f) return { exists: false };
      if (f.state === 'in_transit' && f.vehicleId !== null) {
        // A hauled fragment records its carrier as a string id; vehicles carry numeric ids.
        const vehicle = world.vehicles.vehicles.find(v => String(v.id) === f.vehicleId);
        return vehicle ? { exists: true, anchor: { type: 'host', kind: 'vehicle', id: vehicle.id } } : SELF;
      }
      if (f.state === 'stored' && f.warehouseId !== null) return hostOrSelf(world, 'building', f.warehouseId);
      return SELF;
    }
  }
}

/** A planned site holds this building id while no live building does (not yet built, or destroyed and being rebuilt). */
export function isUnderRebuild(
  world: Pick<GameState, 'buildings' | 'plannedBuildings'>,
  id: number,
): boolean {
  return !world.buildings.buildings.some(b => b.id === id) && world.plannedBuildings.some(pb => pb.buildingId === id);
}

/** Tile rectangle to outline for an anchor: a planned site, or the live building hosting the selection. Vehicles and self keep the ring. */
export function anchorFootprint(anchor: SelectionAnchor, world: Pick<GameState, 'buildings'>): SiteFootprint | null {
  if (anchor.type === 'site') return anchor.footprint;
  if (anchor.type !== 'host' || anchor.kind !== 'building') return null;
  const b = world.buildings.buildings.find(x => x.id === anchor.id);
  return b ? buildingFootprint(b) : null;
}
