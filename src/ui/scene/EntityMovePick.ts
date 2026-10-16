import type { IconName } from '../icons.js';
import { t } from '../../core/i18n/I18n.js';
import { armPointPick, type PlacementKit } from './PlacementKit.js';

type MovablePickKind = 'vehicle' | 'employee';

interface MovePickKind {
  icon: IconName;
  titleKey: string;
  instructionKey: string;
  command: (id: number, x: number, z: number) => string;
}

/** What differs per movable kind: strip icon, copy, and the console command Confirm sends. */
const MOVE_PICK_KINDS: Record<MovablePickKind, MovePickKind> = {
  vehicle: {
    icon: 'vehicle',
    titleKey: 'inspector.move_pick.vehicle.title',
    instructionKey: 'inspector.move_pick.vehicle.instruction',
    command: (id, x, z) => `vehicle reposition ${id} ${x} ${z}`,
  },
  employee: {
    icon: 'person',
    titleKey: 'inspector.move_pick.employee.title',
    instructionKey: 'inspector.move_pick.employee.instruction',
    command: (id, x, z) => `employee dispatch ${id} x:${x} z:${z}`,
  },
};

/** Arms a single-tile pick that moves a vehicle or employee; Confirm runs the kind's console command. */
export function armEntityMovePick(
  kit: PlacementKit,
  target: { kind: MovablePickKind; id: number; name: string; x: number; z: number },
  run: (command: string) => void,
): void {
  const spec = MOVE_PICK_KINDS[target.kind];
  armPointPick(kit, {
    icon: spec.icon,
    title: t(spec.titleKey),
    subtitle: target.name,
    instruction: t(spec.instructionKey),
    result: (sel) => `(${sel.x1}, ${sel.z1})`,
    initialSelection: { x: Math.round(target.x), z: Math.round(target.z) },
    onConfirm: (sel) => run(spec.command(target.id, sel.x1, sel.z1)),
  });
}
