import type { EntityPick } from './scene/ScenePicking.js';

/** The entity currently selected in the scene, as list panels see it. */
export type ListSelection = { kind: EntityPick['kind']; id: number } | null;

/** True when `sel` names exactly the entity (`kind`, `id`). */
export function isSelected(sel: ListSelection, kind: EntityPick['kind'], id: number): boolean {
  return sel !== null && sel.kind === kind && sel.id === id;
}
